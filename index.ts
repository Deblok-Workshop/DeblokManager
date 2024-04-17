
const arch = require('os').arch()
if (arch != 'x64' && arch != "ia32" && arch != "x86_64") {
 console.warn('WARN: DeblokManager seems to be only compatible with x86 and x64 architectures. Expect errors!')
}

import { Elysia, error,t } from "elysia";
import { basicAuth } from '@eelkevdbos/elysia-basic-auth';

import Docker from "dockerode";
import Bun from "bun";
import fs from 'fs';


const conffile = Bun.file("config/config.json");
const config = JSON.parse(await conffile.text());
let sessionKeepalive:any[] = []
let managedContainers:string[] = []
process.env["BASIC_AUTH_CREDENTIALS"] = config.authentication["username"]+":"+config.authentication["password"]


async function ping(url: string): Promise<string> {
    try {
        const response = await fetch(url);
        if (response.status >= 200 && response.status < 400) {
            return 'up';
        } else {
            return 'down';
        }
    } catch (error) {
        return 'down';
    }
}



if (process.argv.includes('--ignore-linux-check') && require("os").platform() != "linux") {
    console.warn('WARN: Incompatibility detected!')
    console.warn(
        "        - DeblokManager can only run on Linux devices.",
    );
    console.warn("          This warning is being ignored due to --ignore-linux-check.")
  } else
  if (require("os").platform() != "linux") {
    console.error("FATAL: Incompatibility detected!");
    console.error(
      "        - DeblokManager can only run on Linux devices.",
    );
    console.error(
      "          Pass --ignore-linux-check to ignore this warning",
    );
    process.exit(2);
  }

if (await ping('http://127.0.0.1:2375/_ping') == "down") {
    console.warn('Extra configuration is needed:');
    console.error(' - The Docker Daemon (dockerd) needs to be running via TCP (:2375).');
    process.exit(2);
}

const docker = new Docker({protocol:'http',host: '127.0.0.1', port: 2375, version: 'v1.44' });

let netaddr = '[::1]';
netaddr = require('os').hostname();

const server = new Elysia();
server.use(
    basicAuth({
        credentials: [config.authentication], 
    })
);

server.get("/", () => {
    return "DeblokManager is alive!";
});

server.get("/containers/list", async () => {
    let dl = await new Promise((resolve, reject) => {
        let containerList: string[] = [];
    
        docker.listContainers((err: any, containers: Docker.ContainerInfo[]) => {
            if (err) {
                console.error(err);
                reject(err);
            } else {
                containers.forEach((container: Docker.ContainerInfo) => {
                    containerList.push(`${container.Id}, ${container.Names[0]}, ${container.Status}`);
                });
                resolve(containerList);
            }
        });
    });
    return dl;
});

async function createContainer(containerOptions:any) {

    try {
        containerOptions.HostConfig = { AutoRemove: true, ...containerOptions.HostConfig };
        // containerOptions.Cmd = containerOptions.Cmd || ['sleep','7d']; // sleep for a week, which is gonna be the max time a nd container can run for. 
        const container = await docker.createContainer(containerOptions);
        
        await container.start();
        return `${container.id}`;
    } catch (err) {
        console.error(err);
        throw err;
    }
}

function readableToBytes(ramString: string): number {
    const match = ramString.match(/^(\d+)([GMB])$/);

    if (match && match.length === 3) {
        const value = parseInt(match[1]);
        const unit = match[2].toUpperCase();

        switch (unit) {
            case "G":
                return value * 1024 * 1024 * 1024;
            case "M":
                return value * 1024 * 1024;
            case "B":
                return value;
            default:
                throw new Error("Invalid RAM unit. Use G, M, or B.");
        }
    } else {
        throw new Error("Invalid RAM format. Use G, M, or B.");
    }
}
server.get("/policy/", async () => {
    return config.policy;
});
server.post("/containers/create", async ({ body, set }) => {
    let b:any=body // the body variable is actually a string, this is here to fix a ts error
    var bjson:any={"name":"","image":"","resources":{"ram":"","cores":""},"ports":""} // boilerplate to not piss off TypeScript.
    
    try {
        
        bjson = JSON.parse(b);
    } catch (e) {
        console.error(e);
        console.error(body)
        set.status = 400;
        return `ERR: ${e}`;
    }
    if (!process.argv.includes('--no-whitelist')) {
        const imagewl = fs.readFileSync('config/list.txt', 'utf-8').split('\n');
        if (!imagewl.includes(bjson.image)) {
          set.status = 400;
          return `ERR: This image (${bjson.image}) is not whitelisted.`;
        }
}
    // Check if required fields are present
    if (!bjson.name || bjson.name == "" || !bjson.image || bjson.image == "") {
        set.status = 400;
        return "ERR: Name and Image fields are required.";
    }


    if (readableToBytes(bjson.resources.ram) > readableToBytes(config.policy.resources.maxram)) {
        set.status = 400;
        return `ERR: RAM exceeds the maximum allowed value of ${config.policy.resources.maxram}.`;
    }


    if (parseFloat(bjson.resources.cores) > parseFloat(config.policy.resources.maxcores)) {
        set.status = 400;
        return `ERR: vCores exceed the maximum allowed value of ${config.policy.resources.maxcores}.`;
    }
    interface PortBinding {
        HostPort: string;
      }

      interface PortBindings {
        [key: string]: PortBinding[];
      }
    const containerOptions = {
        name: bjson.name + "_" + String(crypto.randomUUID()).replaceAll("-",""),
        Image: bjson.image,
        HostConfig: {
          Memory: readableToBytes(bjson.resources.ram), // Set memory limit
          NanoCPUs: Number(bjson.resources.cores * 1e9), // Set CPU limit
          PortBindings: {} as PortBindings, // Set port bindings
        }
      };
      
      // Update the type of PortBindings when setting up port bindings
      if (bjson.ports && bjson.ports !== "") {
        const portPairs = bjson.ports.split(",").map((portPair: any) => portPair.trim());
      
        portPairs.forEach((portPair: string) => {
          const [external, internal] = portPair.split(":").map((port: string) => port.trim());
      
          if (!containerOptions.HostConfig.PortBindings[`${internal}/tcp`]) {
            containerOptions.HostConfig.PortBindings[`${internal}/tcp`] = [];
          }
      
          containerOptions.HostConfig.PortBindings[`${internal}/tcp`].push({ HostPort: external });
        });
      }
    
    

    // Set up port bindings
    if (bjson.ports && bjson.ports !== "") {
        const portPairs = bjson.ports.split(",").map((portPair: any) => portPair.trim());
    
        portPairs.forEach((portPair: string) => {
            const [external, internal] = portPair.split(":").map((port: string) => port.trim());
    
            containerOptions.HostConfig.PortBindings[`${internal}/tcp`] = [{ HostPort: external }];
        });
    }
    
    try {
        
        const result:any = await createContainer(containerOptions);
        console.log(result)
        sessionKeepalive.push([result,Date.now() + config.policy.keepalive.initial * 1000])
        managedContainers.push(result)
        return result;
    } catch (err) {
        set.status = 500;
        console.error(err)
        return err;
    }
});

server.post("/containers/kill", async ({ body, set }) => {
    const b:any=body // the body variable is actually a string, this is here to fix a ts error
    var bjson:any={id:""} // boilerplate to not piss off TypeScript.
    if (managedContainers.indexOf(bjson.id) == -1) {
        set.status = 400;
        return "ERR: DeblokManager doesn't manage this container.";
    }
    try {
        bjson = JSON.parse(b);
    } catch (e) {
        console.error(e);
        set.status = 400;
        return "ERR: Bad JSON";
    }
    try {
        const container = docker.getContainer(bjson.id);
        await container.kill();
        // managedContainers.splice(managedContainers.indexOf(bjson.id),1)
        
removeKeepalive(bjson.id)
        return `${bjson.id}`;
    } catch (err) {
        set.status = 500;
        console.error(err);
        return err;
    }
});

server.post("/containers/delete", async ({ body, set }) => {
    const b:any=body // the body variable is actually a string, this is here to fix a ts error
    var bjson:any={id:""} // boilerplate to not piss off TypeScript.
    if (managedContainers.indexOf(bjson.id) == -1) {
        set.status = 400;
        return "ERR: DeblokManager doesn't manage this container.";
    }
    try {
        bjson = JSON.parse(b);
    } catch (e) {
        console.error(e);
        set.status = 400;
        return "ERR: Bad JSON";
    }
    try {
        const container = docker.getContainer(bjson.id);
        await container.remove();
        managedContainers.splice(managedContainers.indexOf(bjson.id),1)
removeKeepalive(bjson.id)
        return `${bjson.id}`;
    } catch (err) {
        set.status = 500;
        console.error(err);
        return err;
    }
});

server.post("/containers/pause", async ({ body, set }) => {
    const b:any=body // the body variable is actually a string, this is here to fix a ts error
    var bjson:any={id:""} // boilerplate to not piss off TypeScript.
    if (managedContainers.indexOf(bjson.id) == -1) {
        set.status = 400;
        return "ERR: DeblokManager doesn't manage this container.";
    }
    try {
        bjson = JSON.parse(b);
    } catch (e) {
        console.error(e);
        set.status = 400;
        return "ERR: Bad JSON";
    }
    try {
        const container = docker.getContainer(bjson.id);
        await container.pause();
        addToKeepalive(bjson.id,config.policy.keepalive.increment * 1000)
        return `${bjson.id}`;
    } catch (err) {
        set.status = 500;
        console.error(err);
        return err;
    }
});


server.post("/containers/unpause", async ({ body, set }) => {
    const b:any=body // the body variable is actually a string, this is here to fix a ts error
    var bjson:any={id:""} // boilerplate to not piss off TypeScript.
    if (managedContainers.indexOf(bjson.id) == -1) {
        set.status = 400;
        return "ERR: DeblokManager doesn't manage this container.";
    }
    try {
        bjson = JSON.parse(b);
    } catch (e) {
        console.error(e);
        set.status = 400;
        return "ERR: Bad JSON";
    }
    try {
        const container = docker.getContainer(bjson.id);
        await container.unpause();
        addToKeepalive(bjson.id,config.policy.keepalive.initial * 1000) // 1 minute
        return `${bjson.id}`;
    } catch (err) {
        set.status = 500;
        console.error(err);
        return err;
    }
});

server.post("/containers/keepalive", async ({ body, set }) => {
    const b:any=body // the body variable is actually a string, this is here to fix a ts error
    var bjson:any={id:""} // boilerplate to not piss off TypeScript.
    if (managedContainers.indexOf(bjson.id) == -1) {
        set.status = 400;
        return "ERR: DeblokManager doesn't manage this container.";
    }
    try {
        bjson = JSON.parse(b);
    } catch (e) {
        console.error(e);
        set.status = 400;
        return "ERR: Bad JSON";
    }
    if (sessionKeepalive[bjson.id]) {
        addToKeepalive(bjson.id,config.policy.keepalive.initial * 10000) // 5 mins
        return "Updated."
    } else {
        set.status = 400
        return "ERR: Keepalive does not exist."
    }
})

import { networkConnections } from 'systeminformation';
function getPorts(): number[] {
    
    const range: number[] = config["port-range"].split('-').map(Number);
    const startPort: number = range[0];
    const endPort: number = range[1];

    const usedPorts: number[] = Object.values(networkConnections())
        .filter((connection:any) => connection.protocol === 'TCP' || connection.protocol === 'UDP')
        .map((connection:any) => connection.localport);

    const availablePorts: number[] = [];
    for (let port = startPort; port <= endPort; port++) {
        if (!usedPorts.includes(port)) {
            availablePorts.push(port);
        }
    }

    return availablePorts;
}

server.get("/ports/list", async ({body, set}) => {
 try {
    return getPorts()
 } catch (e) {
  set.status = 500;
  console.error(e)
  return ["There was an error retrieving the availiable ports. Are you on x86_64?",e]
 }
 });


console.log(`Listening on port ${config.webserver.port} or`);
console.log(` │ 0.0.0.0:${config.webserver.port}`);
console.log(` │ 127.0.0.1:${config.webserver.port}`);
console.log(` │ ${netaddr}:${config.webserver.port}`);
console.log(` └─────────────────────────>`);
if (process.argv.includes('--no-whitelist')) {
    console.log()
    console.warn('WARN: ####################################')
    console.warn('WARN: # YOU HAVE DISABLED THE WHITELIST! #')
    console.warn('WARN: ####################################')
    console.log()
    console.warn('WARN: Disabling the whitelist allows ANYONE to create/delete/kill ANY Docker container!')
    console.warn('WARN: This has MAJOR security implications, CTRL+C NOW if this was unintentional.')
}

function removeKeepalive(id:string) {
    for (let i = 0;i < sessionKeepalive.length;i++) {
        if (sessionKeepalive[i][0] == id) {
            sessionKeepalive.splice(i,1)
        }
    }
}
function addToKeepalive(id:string,msAdded:number) {
    for (let i = 0;i < sessionKeepalive.length;i++) {
        if (sessionKeepalive[i][0] == id) {
            sessionKeepalive[i][1] = sessionKeepalive[i][1] + msAdded
        }
    }
}

setInterval(async ()=>{
    for (let i = 0;i < sessionKeepalive.length;i++) {
        if (Date.now() > sessionKeepalive[i][1]) {
            
            const container = docker.getContainer(sessionKeepalive[i][0]);
            removeKeepalive(sessionKeepalive[i][0])
            await container.kill();
            await container.remove();
            
        }
    }
},2000)
server.listen(config.webserver);

