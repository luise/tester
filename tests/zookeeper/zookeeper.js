var zookeeper = require("github.com/quilt/zookeeper");
var infrastructure = require("github.com/quilt/tester/config/infrastructure");

var deployment = createDeployment();
deployment.deploy(infrastructure);
deployment.deploy(new zookeeper.Zookeeper(infrastructure.nWorker*2));
