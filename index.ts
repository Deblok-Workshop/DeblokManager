import { Elysia, error } from "elysia";
const conffile = Bun.file("config/config.json")
const config = JSON.parse(await conffile.text())

let netaddr = '[::1]'
netaddr = require('node:os').hostname()

const server = new Elysia();

console.log(`Listening on port ${config.webserver.port} or`),
console.log(` │ 0.0.0.0:${config.webserver.port}`),
console.log(` │ 127.0.0.1:${config.webserver.port}`),
console.log(` │ ${netaddr}:${config.webserver.port}`),
console.log(` └─────────────────────────>`),
server.listen(config.webserver);
