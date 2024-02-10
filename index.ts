import { Elysia, error } from "elysia";
import { basicAuth } from '@eelkevdbos/elysia-basic-auth';
import Docker from "dockerode";
import Bun from "bun";
import { networkConnections } from 'systeminformation';

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

if (require('os').platform() != "linux") {
    console.error('FATAL: Incompatibility detected!')
    console.error('        - Due to the heavy use of Docker, DeblokManager can only run on Linux.')
    process.exit(2)
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

server.post("/containers/delete", async ({body, set}) => {
   // TODO
   set.status = 500
   return "ERR: Not Implemented"
});


function getPorts(): number[] {
    const range: number[] = config["port-range"].split('-').map(Number);
    const startPort: number = range[0];
    const endPort: number = range[1];

    const usedPorts: number[] = Object.values(networkConnections())
        .filter(connection => connection.protocol === 'TCP' || connection.protocol === 'UDP')
        .map(connection => connection.localport);

    const availablePorts: number[] = [];
    for (let port = startPort; port <= endPort; port++) {
        if (!usedPorts.includes(port)) {
            availablePorts.push(port);
        }
    }

    return availablePorts;
}

server.get("/ports/list", async ({body, set}) => {
    return getPorts()
 });

console.log(`Listening on port ${config.webserver.port} or`);
console.log(` │ 0.0.0.0:${config.webserver.port}`);
console.log(` │ 127.0.0.1:${config.webserver.port}`);
console.log(` │ ${netaddr}:${config.webserver.port}`);
console.log(` └─────────────────────────>`);
server.listen(config.webserver);

