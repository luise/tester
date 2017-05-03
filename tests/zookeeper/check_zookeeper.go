package main

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/quilt/quilt/api"
	"github.com/quilt/quilt/api/client/getter"
	"github.com/quilt/quilt/db"
	"github.com/satori/go.uuid"

	log "github.com/Sirupsen/logrus"
)

func main() {
	clientGetter := getter.New()

	clnt, err := clientGetter.Client(api.DefaultSocket)
	if err != nil {
		log.WithError(err).Fatal("FAILED, couldn't get quiltctl client")
	}
	defer clnt.Close()

	leader, err := clientGetter.LeaderClient(clnt)
	if err != nil {
		log.WithError(err).Fatal("FAILED, couldn't get leader client")
	}

	containers, err := leader.QueryContainers()
	if err != nil {
		log.WithError(err).Fatal("FAILED, couldn't query containers")
	}

	var zkContainers []db.Container
	for _, c := range containers {
		if strings.Contains(c.Image, "zookeeper") {
			zkContainers = append(zkContainers, c)
		}
	}

	if test(zkContainers) {
		log.Info("PASSED")
	} else {
		log.Info("FAILED")
	}
}

// Write a random key value pair to each zookeeper node, and then ensure that
// all nodes can retrieve all the written keys.
func test(containers []db.Container) bool {
	passed := true

	expData := map[string]string{}
	for _, c := range containers {
		key := "/" + uuid.NewV4().String()
		expData[key] = uuid.NewV4().String()

		fmt.Printf("Writing %s to key %s from %s\n", expData[key], key, c.StitchID)
		out, err := exec.Command("quilt", "ssh", c.StitchID,
			"bin/zkCli.sh", "create", key, expData[key]).CombinedOutput()
		if err != nil {
			log.WithError(err).Error("FAILED, unable to create key")
			fmt.Println(string(out))
			passed = false
		}
	}

	for _, c := range containers {
		for key, val := range expData {
			fmt.Printf("Getting key %s from %s: expect %s\n", key, c.StitchID, val)
			out, err := exec.Command("quilt", "ssh", c.StitchID,
				"bin/zkCli.sh", "get", key).CombinedOutput()
			if err != nil || !strings.Contains(string(out), val) {
				log.WithError(err).Error("FAILED, unexpected value")
				fmt.Println(string(out))
				passed = false
			}
		}
	}

	return passed
}
