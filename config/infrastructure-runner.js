const {createDeployment} = require("@quilt/quilt");
var infrastructure = require("./infrastructure.js")

createDeployment({}).deploy(infrastructure);
