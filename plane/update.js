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

await utils.searchReplace(
  "./code/.env.example",
  "APP_DOMAIN=localhost",
  "APP_DOMAIN=$(PRIMARY_DOMAIN)"
);

await utils.searchReplace(
  "./code/.env.example",
  "WEB_URL=http://${APP_DOMAIN}",
  "WEB_URL=https://$(PRIMARY_DOMAIN)"
);

await utils.searchReplace(
  "./code/.env.example",
  "CORS_ALLOWED_ORIGINS=http://${APP_DOMAIN}",
  "CORS_ALLOWED_ORIGINS=https://$(PRIMARY_DOMAIN)"
);