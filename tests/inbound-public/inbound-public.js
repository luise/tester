const {createDeployment} = require("@quilt/quilt");
var nginx = require("@quilt/nginx");
var infrastructure = require("../../config/infrastructure.js")

var deployment = createDeployment({});
deployment.deploy(infrastructure);

for (var i = 0 ; i < infrastructure.nWorker ; i++) {
    deployment.deploy(nginx.New(80));
    deployment.deploy(nginx.New(8000));
}
