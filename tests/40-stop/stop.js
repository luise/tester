// Place a google/pause container on each worker machine.

const {createDeployment, Service, Container, LabelRule} = require("@quilt/quilt");
var infrastructure = require("../../config/infrastructure.js")

var deployment = createDeployment({});
deployment.deploy(infrastructure);

var containers = new Service("containers",
    new Container("google/pause").replicate(infrastructure.nWorker));
containers.place(new LabelRule(true, containers));

deployment.deploy(containers);
