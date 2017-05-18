package main

import (
	"fmt"
	"os/exec"
	"strings"
	"time"

	log "github.com/Sirupsen/logrus"

	"github.com/quilt/quilt/api"
	"github.com/quilt/quilt/api/client/getter"
	"github.com/quilt/quilt/util"
)

func main() {
	clientGetter := getter.New()

	clnt, err := clientGetter.Client(api.DefaultSocket)
	if err != nil {
		log.WithError(err).Fatal("FAILED, couldn't get quiltctl client.")
	}
	defer clnt.Close()

	leader, err := clientGetter.LeaderClient(clnt)
	if err != nil {
		log.WithError(err).Fatal("FAILED, couldn't get leader client.")
	}

	containers, err := leader.QueryContainers()
	if err != nil {
		log.WithError(err).Fatal("FAILED, couldn't query containers.")
	}

	containersPretty, _ := exec.Command("quilt", "ps").Output()
	fmt.Println("`quilt ps` output:")
	fmt.Println(string(containersPretty))

	var id string
	for _, dbc := range containers {
		if strings.Join(dbc.Command, " ") == "run master" {
			id = dbc.StitchID
			break
		}
	}
	if id == "" {
		log.Fatal("FAILED, unable to find StitchID of Spark master.")
	}

	// The Spark job takes some time to complete, so we wait for the appropriate
	// result for up to a minute.
	err = util.WaitFor(func() bool {
		logs, err := exec.Command("quilt", "logs", id).CombinedOutput()
		if err != nil {
			log.WithError(err).Fatal("FAILED, Unable to get Spark master logs.")
			return false
		}

		fmt.Printf("`quilt logs %s` output:\n", id)
		fmt.Println(string(logs))
		return strings.Contains(string(logs), "Pi is roughly")
	}, 5*time.Second, time.Minute)

	if err != nil {
		fmt.Println("FAILED, sparkPI did not execute correctly.")
	} else {
		fmt.Println("PASSED")
	}
}
