import { Elysia, error } from "elysia";
import { basicAuth } from '@eelkevdbos/elysia-basic-auth';
import Docker from "dockerode";
import Bun from "bun";

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

console.log(await ping('http://127.0.0.1:2375/_ping'));
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

server.get("/containers/list", async ({body, set}) => {
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

async function createContainer(containerOptions) {
    try {
        const container = await docker.createContainer(containerOptions);
        await container.start();
        return `Container ${container.id} created and started successfully.`;
    } catch (err) {
        console.error('Error creating container:', err);
        throw err;
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

    // Set up container creation options
    const containerOptions = {
        name: bjson.name,
        Image: bjson.image,
        HostConfig: {
            Memory: bjson.resources.ram, // Set memory limit
            NanoCPUs: bjson.resources.cores * 1e9, // Set CPU limit
            PortBindings: {}, // Set port bindings
        }
    };

    // Bind ports if provided
    if (bjson.ports && bjson.ports !== "") {
        const ports = bjson.ports.split(",").map((port: any) => parseInt(port.trim()));
        ports.forEach(port => {
            containerOptions.HostConfig.PortBindings[`${port}/tcp`] = [{ HostPort: `${port}` }];
        });
    }

    try {
        const result = await createContainer(containerOptions);
        return result;
    } catch (err) {
        set.status = 500;
        return "ERR: Failed to create container.";
    }
});

console.log(`Listening on port ${config.webserver.port} or`);
console.log(` │ 0.0.0.0:${config.webserver.port}`);
console.log(` │ 127.0.0.1:${config.webserver.port}`);
console.log(` │ ${netaddr}:${config.webserver.port}`);
console.log(` └─────────────────────────>`);
server.listen(config.webserver);

