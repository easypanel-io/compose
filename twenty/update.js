import utils from "../utils.js";

await utils.cloneOrPullRepo({ repo: "git@github.com:twentyhq/twenty.git" });
await utils.copyDir("./repo/packages/twenty-docker", "./code");

await utils.removeContainerNames("./code/docker-compose.yml");
await utils.removePorts("./code/docker-compose.yml");
