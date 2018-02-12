const fs = require('fs');
const path = require('path');
const kelda = require('kelda');
const sshpk = require('sshpk');

// XXX: In order for the releases to be easily downloadable over HTTP, this
// container also runs an Nginx process. Once Kelda has support for volumes,
// the Nginx process should be run from another container, and the releases
// should be shared using a volume.
class SCPServer extends kelda.Container {
  /**
   * @param {string} user The username to allow connections to the SCP server.
   * @param {int} port The port the SCP server will listen on.
   * @param {KeyPair} userKeyPair The credentials that user will use to
   *   authenticate itself to the server.
   * @param {KeyPair} hostKeyPair The credentials that clients will use to
   *   authenticate the server.
   * @return {void}
   */
  constructor(user, port, userKeyPair, hostKeyPair) {
    const image = new kelda.Image({
      name: 'scp-server',
      dockerfile: fs.readFileSync(path.join(__dirname, 'Dockerfile'), { encoding: 'utf8' }),
    });
    const hostKeyType = sshpk.parsePrivateKey(hostKeyPair.priv).type;
    const hostKeyPath = `/etc/ssh/ssh_host_${hostKeyType}_key`;
    const nginxConf = `server {
      root /home/${user}/releases;
      location / { autoindex on; }
    }`;
    super({
      name: 'scp',
      image,
      command: ['bash', '-c',
        // XXX: We need to chmod the host's private key because
        // filepathToContent doesn't support setting file modes.
        `chmod 0600 ${hostKeyPath} ` +
          // Create the user, and start the SCP server.
          `&& useradd --shell /usr/bin/rssh ${user} ` +
          `&& mkdir /home/${user}/releases ` +
          `&& chown -R ${user} /home/${user} ` +
          '&& nginx ' +
          `&& /usr/sbin/sshd -p ${port} -D -e`,
      ],
      filepathToContent: {
        [`/home/${user}/.ssh/authorized_keys`]: userKeyPair.pub,
        [hostKeyPath]: hostKeyPair.priv,
        [`${hostKeyPath}.pub`]: hostKeyPair.pub,
        '/etc/nginx/sites-enabled/default': nginxConf,
      },
    });

    this.user = user;
    this.port = port;
    this.userKeyPair = userKeyPair;
    this.hostKeyPair = hostKeyPair;
  }

  /**
   * Allow the client to connect to the SCP server.
   *
   * @param {kelda.Container} client The container to allow inbound connections from.
   * @return {void}
   */
  allowSCPFrom(client) {
    kelda.allowTraffic(client, this, this.port);
  }

  /**
   * Allow the client to connect to the Nginx server.
   *
   * @param {kelda.Container} client The container to allow inbound connections from.
   */
  allowHTTPFrom(client) {
    kelda.allowTraffic(client, this, 80);
  }

  /**
   * Generate the scp command to copy remotePath from the SCP server to localPath
   * on the local machine.
   * @param {string} remotePath the file to copy on the SCP server.
   * @param {string} localPath the local destination to write the file.
   * @param {[string]} identityFile the path to the private SSH key to use for
   * authentication.
   * @param {[knownHostsFile]} knownHostsFile the path to the known hosts file that
   * specifies acceptable public keys for the remote server.
   * @return {string} the command that should be run in order to copy the specified
   * file.
   */
  getCommand(remotePath, localPath, { identityFile = '', knownHostsFile = '' } = {}) {
    const args = ['scp', '-P', this.port.toString()];
    if (identityFile !== '') {
      args.push('-i', identityFile);
    }

    if (knownHostsFile !== '') {
      args.push('-o', `UserKnownHostsFile=${knownHostsFile}`);
    }

    args.push(`${this.user}@${this.getHostname()}:${remotePath}`, localPath);

    return args.join(' ');
  }
}

module.exports = SCPServer;
