package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/quilt/quilt/api"
	"github.com/quilt/quilt/api/client"
	"github.com/quilt/quilt/db"
	"github.com/quilt/quilt/util"
)

// runSpecUntilConnected runs the given spec, and blocks until either all
// machines have connected back to the daemon, or 500 seconds have passed.
func runSpecUntilConnected(spec string) (string, string, error) {
	cmd := exec.Command("quilt", "run", "-f", spec)
	stdout, stderr, err := execCmd(cmd, "INFRA")
	if err != nil {
		return stdout, stderr, err
	}

	allMachinesConnected := func() bool {
		machines, err := queryMachines()
		if err != nil {
			return false
		}

		for _, m := range machines {
			if !m.Connected {
				return false
			}
		}

		return true
	}

	err = util.WaitFor(allMachinesConnected, 1*time.Second, 8*time.Minute)
	return stdout, stderr, err
}

// stop stops the given namespace, and waits 2 minutes for the command
// to take effect.
func stop(namespace string) (string, string, error) {
	cmd := exec.Command("quilt", "stop", namespace)

	stdout, stderr, err := execCmd(cmd, "STOP")
	if err != nil {
		return stdout, stderr, err
	}

	time.Sleep(2 * time.Minute)
	return stdout, stderr, nil
}

// npmInstall installs the npm dependencies in the current directory.
func npmInstall() (string, string, error) {
	cmd := exec.Command("npm", "install", ".")
	return execCmd(cmd, "NPM-INSTALL")
}

// runSpec runs the given spec. Note that it does not block on the connection
// status of the machines.
func runSpec(spec string) (string, string, error) {
	cmd := exec.Command("quilt", "run", "-f", spec)
	return execCmd(cmd, "RUN")
}

// runQuiltDaemon starts the daemon.
func runQuiltDaemon() {
	os.Remove(api.DefaultSocket[len("unix://"):])
	cmd := exec.Command("quilt", "-l", "debug", "daemon")
	execCmd(cmd, "QUILT")
}

func logAndUpdate(sc bufio.Scanner, l fileLogger, logFmt string) chan string {
	outputChan := make(chan string, 1)
	go func() {
		// This loop exits when the scanner reaches the end of input, which
		// happens when the command terminates. Thus, we don't need a channel
		// to force this thread to exit.
		var output string
		for sc.Scan() {
			line := sc.Text()
			output += line

			// Remove the newline if there is one because println
			// appends one automatically.
			logStr := strings.TrimSuffix(line, "\n")
			l.println(fmt.Sprintf(logFmt, logStr))
		}
		outputChan <- output
	}()
	return outputChan
}

// execCmd executes the given command, and returns the stdout and stderr output.
// `logLineTitle` is the prefix for logging to the container log.
func execCmd(cmd *exec.Cmd, logLineTitle string) (string, string, error) {
	l := log.cmdLogger

	l.infoln(fmt.Sprintf("%s: Starting command: %v", logLineTitle, cmd.Args))

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", "", err
	}

	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return "", "", err
	}

	// Save the command output while logging it.
	logFormatter := logLineTitle + " (%s): %%s"
	stdoutChan := logAndUpdate(*bufio.NewScanner(stdoutPipe), l,
		fmt.Sprintf(logFormatter, "stdout"))
	stderrChan := logAndUpdate(*bufio.NewScanner(stderrPipe), l,
		fmt.Sprintf(logFormatter, "stderr"))

	if err := cmd.Start(); err != nil {
		return "", "", err
	}

	stdout := <-stdoutChan
	stderr := <-stderrChan
	err = cmd.Wait()
	l.infoln(fmt.Sprintf("%s: Completed command: %v", logLineTitle, cmd.Args))
	return stdout, stderr, err
}

func sshGen(host string, cmd *exec.Cmd) *exec.Cmd {
	script := "ssh"
	args := []string{"-o", "UserKnownHostsFile=/dev/null", "-o",
		"StrictHostKeyChecking=no", fmt.Sprintf("quilt@%s", host)}
	args = append(args, cmd.Args...)
	sshCmd := exec.Command(script, args...)
	return sshCmd
}

func scp(host string, source string, target string) error {
	cmd := exec.Command("scp", "-o", "UserKnownHostsFile=/dev/null", "-o",
		"StrictHostKeyChecking=no", source,
		fmt.Sprintf("quilt@%s:%s", host, target))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return errors.New(string(out))
	}
	return nil
}

func queryMachines() ([]db.Machine, error) {
	c, err := client.New(api.DefaultSocket)
	if err != nil {
		return []db.Machine{}, err
	}
	defer c.Close()

	return c.QueryMachines()
}

func cleanupMachines(namespace string) {
	l := log.testerLogger

	l.infoln("Cleaning up first with `quilt stop`.")
	if _, _, err := stop(namespace); err != nil {
		l.infoln("`quilt stop` errored.")
		l.errorln(err.Error())
	}
	l.infoln("Done cleaning up.")
}
