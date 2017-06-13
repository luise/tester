const {createDeployment, Service, Container, publicInternet} = require("@quilt/quilt");
var infrastructure = require("../../config/infrastructure.js")

var deployment = createDeployment();
deployment.deploy(infrastructure);

var connected = new Service("connected",
    new Container("alpine", ["tail", "-f", "/dev/null"])
        .replicate(infrastructure.nWorker*2)
);
publicInternet.allowFrom(connected, 80);

var notConnected = new Service("not-connected",
    new Container("alpine", ["tail", "-f", "/dev/null"])
        .replicate(infrastructure.nWorker*2)
);

deployment.deploy([connected, notConnected]);
