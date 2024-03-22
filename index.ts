
const arch = require('os').arch()
if (arch != 'x64' && arch != "ia32" && arch != "x86_64") {
 console.warn('WARN: DeblokManager seems to be only compatible with x86 and x64 architectures. Expect errors!')
}

import { Elysia, error } from "elysia";
import { basicAuth } from '@eelkevdbos/elysia-basic-auth';
import Docker from "dockerode";
import Bun from "bun";
import fs from 'fs';


const conffile = Bun.file("config/config.json");
const config = JSON.parse(await conffile.text());


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
        containerOptions.Cmd = containerOptions.Cmd || ['yes', '>', '/dev/null']; // yes > /dev/null is the only way i can think of keeping a docker container running forever
        const container = await docker.createContainer(containerOptions);
        
        await container.start();
        return `Container ${container.id} created and started successfully.`;
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

server.post("/containers/create", async ({body, set}) => {
    const b:any=body // the body variable is actually a string, this is here to fix a ts error
    var bjson:any={"name":"","image":"","resources":{"ram":"","cores":""},"ports":""} // boilerplate to not piss off TypeScript.
    if (!process.argv.includes('--no-whitelist')) {
        const imagewl = fs.readFileSync('config/list.txt', 'utf-8').split('\n');
        if (!imagewl.includes(bjson.id)) {
          set.status = 400;
          return `ERR: This image (${bjson.id}) is not whitelisted.`;
        }
}
    try {
        bjson = JSON.parse(b);
    } catch (e) {
        console.error(e);
        set.status = 400;
        return "ERR: Bad JSON";
    }

    // Check if required fields are present
    if (!bjson.name || bjson.name == "" || !bjson.image || bjson.image == "") {
        set.status = 400;
        return "ERR: Name and Image fields are required.";
    }


    if (readableToBytes(bjson.resources.ram) > readableToBytes(config.resources.maxram)) {
        set.status = 400;
        return `ERR: RAM exceeds the maximum allowed value of ${config.resources.maxram}.`;
    }


    if (parseFloat(bjson.resources.cores) > parseFloat(config.resources.maxcores)) {
        set.status = 400;
        return `ERR: vCores exceed the maximum allowed value of ${config.resources.maxcores}.`;
    }
    // Set up container creation options
    const containerOptions = {
        name: bjson.name,
        Image: bjson.image,
        HostConfig: {
            Memory: readableToBytes(bjson.resources.ram), // Set memory limit
            NanoCPUs: Number(bjson.resources.cores * 1e9), // Set CPU limit
            PortBindings: {}, // Set port bindings
        }
    };

    if (bjson.ports && bjson.ports !== "") {
        const portPairs = bjson.ports.split(",").map((portPair: any) => portPair.trim());
        const portRange = config["port-range"].split("-").map((port: string) => parseInt(port.trim()));
        const minPort = portRange[0];
        const maxPort = portRange[1];
        const invalidPorts = portPairs
            .map((portPair: string) => parseInt(portPair.split(":")[0].trim()))
            .filter((port: number) => port < minPort || port > maxPort);
    
        if (invalidPorts.length > 0) {
            set.status = 400;
            return `ERR: External port(s) ${invalidPorts.join(', ')} are outside the allowed range (${minPort} - ${maxPort}).`;
        }
    
        portPairs.forEach((portPair: string) => {
            const [external, internal] = portPair.split(":").map((port: string) => port.trim());
            (containerOptions.HostConfig.PortBindings as Record<string, any>)[`${external}/tcp`] = [{ HostPort: internal }];
        });
    }

    try {
        const result = await createContainer(containerOptions);
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
    if (!process.argv.includes('--no-whitelist')) {
        const imagewl = fs.readFileSync('config/list.txt', 'utf-8').split('\n');
        if (!imagewl.includes(bjson.id)) {
          set.status = 400;
          return `ERR: This image (${bjson.id}) is not whitelisted.`; // spark has w rizz
        }
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
        return `Container ${bjson.id} killed successfully.`;
    } catch (err) {
        set.status = 500;
        console.error(err);
        return err;
    }
});

server.post("/containers/delete", async ({ body, set }) => {
    const b:any=body // the body variable is actually a string, this is here to fix a ts error
    var bjson:any={id:""} // boilerplate to not piss off TypeScript.
    if (!process.argv.includes('--no-whitelist')) {
        const imagewl = fs.readFileSync('config/list.txt', 'utf-8').split('\n');
        if (!imagewl.includes(bjson.id)) {
          set.status = 400;
          return `ERR: This image (${bjson.id}) is not whitelisted.`;
        }
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
        return `Container ${bjson.id} deleted successfully.`;
    } catch (err) {
        set.status = 500;
        console.error(err);
        return err;
    }
});
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
server.listen(config.webserver);

