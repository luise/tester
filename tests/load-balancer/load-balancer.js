const {createDeployment, Container, Service} = require("@quilt/quilt");
var infrastructure = require("../../config/infrastructure.js")

var deployment = createDeployment({});
deployment.deploy(infrastructure);

var containers = [];
for (var i = 0 ; i < 4 ; i++) {
  containers.push(new Container("nginx:1.10").withFiles({
    '/usr/share/nginx/html/index.html': "I am container number " + i.toString() + "\n",
  }));
}

var fetcher = new Service("fetcher", [new Container("alpine", ["tail", "-f", "/dev/null"])]);
var loadBalanced = new Service("loadBalanced", containers);
loadBalanced.allowFrom(fetcher, 80);

deployment.deploy([fetcher, loadBalanced]);
