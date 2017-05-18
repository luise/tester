const {createDeployment} = require("@quilt/quilt");
var spark = require("@quilt/spark");
var infrastructure = require("../../config/infrastructure.js")

var deployment = createDeployment({});
deployment.deploy(infrastructure);

var sprk = new spark.Spark(1, 3);
var sprk2 = new spark.Spark(1, 3);

deployment.deploy(sprk);
deployment.deploy(sprk2);
