import utils from "../utils.js";

await utils.cloneOrPullRepo({ repo: "git@github.com:twentyhq/twenty.git" });
await utils.copyDir("./repo/packages/twenty-docker", "./code");

await utils.removeContainerNames("./code/docker-compose.yml");
await utils.removePorts("./code/docker-compose.yml");

await utils.searchReplace(
  "./code/.env.example",
  "#REDIS_URL=redis://redis:6379",
  "REDIS_URL=redis://redis:6379"
);

await utils.searchReplace(
  "./code/.env.example",
  "SERVER_URL=http://localhost:3000",
  "SERVER_URL=https://$(PRIMARY_DOMAIN)"
);

await utils.searchReplace(
  "./code/.env.example",
  "# APP_SECRET=replace_me_with_a_random_string",
  "APP_SECRET=replace_me_with_a_random_string"
);
