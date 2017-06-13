const {createDeployment, Service, Container} = require("@quilt/quilt");
var infrastructure = require("../../config/infrastructure.js")

var deployment = createDeployment({});
deployment.deploy(infrastructure);

var c = new Container("alpine", ["tail", "-f", "/dev/null"]);
var red = new Service("red", c.replicate(5));
var blue = new Service("blue", c.replicate(5));
var yellow = new Service("yellow", c.replicate(5));

blue.allowFrom(red, 80);
red.allowFrom(blue, 80);
yellow.allowFrom(red, 80);
yellow.allowFrom(blue, 80);

deployment.deploy(red);
deployment.deploy(blue);
deployment.deploy(yellow);
