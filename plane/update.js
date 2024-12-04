import utils from "../utils.js";

await utils.cloneOrPullRepo({
  repo: "https://github.com/makeplane/plane.git",
  path: "./repo",
  branch: "preview",
});

await utils.copyDir("./repo/deploy/selfhost", "./code");
await utils.renameFile("./code/variables.env", "./code/.env.example");

await utils.removeContainerNames("./code/docker-compose.yml");
await utils.removePorts("./code/docker-compose.yml");
