import { Elysia, error } from "elysia";
import { basicAuth } from '@eelkevdbos/elysia-basic-auth'
import Docker from "dockerode"

const conffile = Bun.file("config/config.json")
const config = JSON.parse(await conffile.text())

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
console.log(await ping('http://127.0.0.1:2375/_ping'))
if (await ping('http://127.0.0.1:2375/_ping') == "down") {
    console.warn('Extra configuration is needed:')
    console.error(' - The Docker Daemon (dockerd) needs to be running via TCP (:2375).')
    process.exit(2)
}

//if (process.env.USER != "root" || !config['should-be-running-as'].includes(process.env.USER)) {
//    console.error('Due to the amount of Docker usage, this server should be running as root,')
//    console.error('or some user whom can access docker without sudo.')
//    process.exit(2)
//}
// test if Dockerode NEEDS root first.

const docker = new Docker({protocol:'http',host: '127.0.0.1', port: 2375, version: 'v1.44' });

let netaddr = '[::1]'
netaddr = require('node:os').hostname()

const server = new Elysia();
server.use(
    basicAuth({
      credentials: [config.authentication], 
    })
  )

server.get("/", () => {
    return "DeblokManager is alive!";
})


server.get("/containers/list", async ({body, set}) => {
   let dl =  await new Promise((resolve, reject) => {
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
    return dl
})

server.post("/containers/request", async ({body, set}) => {
    const b:any=body // the body variable is actually a string, this is here to fix a ts error
    var bjson:any={"name":"","image":"","resources":{"ram":"","cores":""},"ports":""} // boilerplate to not piss off TypeScript.

    try {
      bjson = JSON.parse(b);
    } catch (e) {
      console.error(e);
      set.status = 400;
      return "ERR: Bad JSON";
    }
  
    if (
      !bjson.name ||
      bjson.name == "" ||
      !bjson.image ||
      bjson.image == "" ||
      !bjson.resources ||
      JSON.stringify(bjson.resources) == '{"ram":"","cores":""}' ||
      !bjson.ports ||
      bjson.ports == "" ||
      !bjson.resources.ram || // who the fuck prettified this
      !bjson.resources.cores ||
      bjson.resources.ram == "" ||
      bjson.resources.cores == ""
    ) {
      set.status = 400;
      return "ERR: One or more fields are missing or invalid.";
    }
  
    // check image whitelist
    const wlFile = Bun.file("./config/list.txt");
    const wlImages = await (await wlFile.text()).split('\n')
    if (!wlImages.includes(bjson.image)) {
      set.status = 400;
      return "ERR: The specified image is not whitelisted.";
    }
  
    // make sure no dumbass eats my entire computer frfr
    const maxRam = config.resources.maxram;
    const maxCores = config.resources.maxcores;
    const ramRegex = /^(\d+)([GMB])$/;
    const ramMatch = bjson.resources.ram.match(ramRegex);
    
    if (!ramMatch || ramMatch.length !== 3) {
      set.status = 400;
      return "ERR: Invalid RAM format. Use G for gigabytes, M for megabytes, and B for bytes.";
    }
    
    const ramValue = parseInt(ramMatch[1]);
    const ramUnit = ramMatch[2];
    
    const convertToBytes = (value: number, unit: string): number => {
      switch (unit) {
        case "G":
          return value * 1024 * 1024 * 1024;
        case "M":
          return value * 1024 * 1024;
        case "B":
          return value;
        default:
          return NaN;
      }
    };
    
    const ramInBytes = convertToBytes(ramValue, ramUnit);
    
    if (isNaN(ramInBytes) || ramInBytes > maxRam) {
      set.status = 400;
      return `ERR: RAM exceeds the maximum allowed value of ${maxRam}G.`;
    }
    const coresValue = parseInt(bjson.resources.cores);
    if (coresValue > maxCores) {
      set.status = 400;
      return `ERR: Cores exceed the maximum allowed value of ${maxCores}.`;
    }
  
    // Check if ports are within the specified range
    const portRange = config["port-range"].split("-");
    const minPort = parseInt(portRange[0]);
    const maxPort = parseInt(portRange[1]);
  
    const ports = bjson.ports.split(",").map((port:any) => parseInt(port.trim()));
    for (const port of ports) {
      if (isNaN(port) || port < minPort || port > maxPort) {
        set.status = 400;
        return `ERR: Port ${port} is outside the allowed range of ${minPort}-${maxPort}.`;
      }
    }
  
    return "TODO";
})

console.log(`Listening on port ${config.webserver.port} or`),
console.log(` │ 0.0.0.0:${config.webserver.port}`),
console.log(` │ 127.0.0.1:${config.webserver.port}`),
console.log(` │ ${netaddr}:${config.webserver.port}`),
console.log(` └─────────────────────────>`),
server.listen(config.webserver);
