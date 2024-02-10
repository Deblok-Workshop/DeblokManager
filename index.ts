import { Elysia, error } from "elysia";
import { basicAuth } from '@eelkevdbos/elysia-basic-auth'

const conffile = Bun.file("config/config.json")
const config = JSON.parse(await conffile.text())

if (process.env.USER != "root" || !config['should-be-running-as'].includes(process.env.USER)) {
    console.error('Due to the amount of Docker usage, this server should be running as root,')
    console.error('or some user whom can access docker without sudo.')
    process.exit(2)
}

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

server.post("/containers/request", async ({body, set}) => {
    const b:any=body // the body variable is actually a string, this is here to fix a ts error
    var bjson:any={"name":"","image":"","resources":{"ram":"","cores":""},"ports":""} // boilerplate to not piss off TypeScript.
    try {
        bjson=JSON.parse(b)
    } catch (e) {console.error(e);set.status = 400; return "ERR: Bad JSON"}
    if (
        !bjson['name'] || bjson['name'] == "" ||
        !bjson['image'] || bjson['image'] == "" ||
        !bjson['resources'] || JSON.stringify(bjson['resources']) == "{\"ram\":\"\",\"cores\":\"\"}" ||
        !bjson['ports'] || bjson['ports'] == "" || 
        !bjson['resources']['ram'] || !bjson['resources']['ram'] ||
        !bjson['resources']['cores'] || bjson['resources']['cores'] == "" 
       ) {
        set.status = 400; return "ERR: One or more fields are missing or invalid."
       }
    return "DeblokManager is alive!";
})

console.log(`Listening on port ${config.webserver.port} or`),
console.log(` │ 0.0.0.0:${config.webserver.port}`),
console.log(` │ 127.0.0.1:${config.webserver.port}`),
console.log(` │ ${netaddr}:${config.webserver.port}`),
console.log(` └─────────────────────────>`),
server.listen(config.webserver);
