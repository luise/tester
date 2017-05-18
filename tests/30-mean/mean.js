const {createDeployment} = require("@quilt/quilt");
var HaProxy = require("@quilt/haproxy").Haproxy;
var Mongo = require("@quilt/mongo");
var Node = require("@quilt/nodejs");
var infrastructure = require("../../config/infrastructure.js")

var deployment = createDeployment({});
deployment.deploy(infrastructure);

var mongo = new Mongo(3);
var app = new Node({
  nWorker: 3,
  repo: "https://github.com/tejasmanohar/node-todo.git",
  env: {
    PORT: "80",
    MONGO_URI: mongo.uri("mean-example")
  }
});
var haproxy = new HaProxy(3, app.services());

mongo.connect(mongo.port, app);
app.connect(mongo.port, mongo);
haproxy.public();

deployment.deploy(app);
deployment.deploy(mongo);
deployment.deploy(haproxy);
