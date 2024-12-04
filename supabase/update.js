import utils from "../utils.js";

await utils.cloneOrPullRepo({ repo: "https://github.com/supabase/supabase" });
await utils.copyDir("./repo/docker", "./code");

await utils.removeContainerNames("./code/docker-compose.yml");
await utils.removePorts("./code/docker-compose.yml");
