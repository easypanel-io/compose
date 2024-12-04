import { execa } from "execa";
import fs from "fs";
import yaml from "yaml";

async function cloneOrPullRepo({
  repo,
  path = "./repo",
  branch = "main",
  depth = 1,
}) {
  if (!fs.existsSync(path)) {
    console.log(`Cloning ${repo} into ${path}`);
    await execa(
      "git",
      [
        "clone",
        ["--depth", depth],
        ["--branch", branch],
        "--single-branch",
        repo,
        path,
      ].flat()
    );
  } else {
    console.log(`Pulling ${repo} into ${path}`);
    await execa("git", ["pull"], { cwd: path });
  }
}

async function removeContainerNames(path) {
  console.log(`Removing container names from ${path}`);

  const file = await fs.promises.readFile(path, "utf8");
  const document = yaml.parseDocument(file);

  document.get("services").items.forEach((item) => {
    item.value.delete("container_name");
  });

  await fs.promises.writeFile(path, document.toString());
}

async function removePorts(path) {
  console.log(`Removing ports from ${path}`);

  const file = await fs.promises.readFile(path, "utf8");
  const document = yaml.parseDocument(file);

  document.get("services").items.forEach((item) => {
    item.value.delete("ports");
  });

  await fs.promises.writeFile(path, document.toString());
}

async function copyDir(src, dest) {
  console.log(`Copying ${src} to ${dest}`);

  await execa("rm", ["-rf", dest]);
  await execa("cp", ["-r", src, dest]);
}

async function downloadFile(url, dest) {
  console.log(`Downloading ${url} to ${dest}`);

  await execa("curl", ["-s", url, "-o", dest]);
}

async function renameFile(src, dest) {
  console.log(`Renaming ${src} to ${dest}`);

  await execa("mv", [src, dest]);
}

export default {
  cloneOrPullRepo,
  removeContainerNames,
  removePorts,
  copyDir,
  downloadFile,
  renameFile,
};
