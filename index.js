const path = require("path");
const fs = require("fs");
const inquirer = require("inquirer").default;
const whenExit = require("when-exit").default;
const { getWallpaper, setWallpaper } = require("wallpaper");
const Watcher = require("watcher").default;
const lz4 = require("lz4");

const userHomeDir = process.env.HOME || process.env.USERPROFILE;
const zenGlobalFile = `${userHomeDir}/Library/Application Support/zen/Profiles/`;

var decompressMozLZ4 = function (inputBuffer) {
  var outputBuffer;
  // Verify inputBuffer is a buffer
  if (!Buffer.isBuffer(inputBuffer)) {
    throw new Error("Input is not of type Buffer");
    return false;
  }
  // Verifiy custom Mozilla LZ4 header / Magic number
  if (inputBuffer.slice(0, 8).toString() !== "mozLz40\0") {
    throw new Error("Input does not seem to be jsonlz4 format");
    return false;
  }
  outputBuffer = Buffer.alloc(inputBuffer.readUInt32LE(8));
  lz4.decodeBlock(inputBuffer, outputBuffer, 12);
  return JSON.parse(outputBuffer.toString());
};

const getFileNameFromId = (id) => {
  // Remove { and } from id
  return id.replace(/{|}/g, "");
};

const setWallpaperForSpace = (pathToImage) => {
  return setWallpaper(`.wallpapers/${getFileNameFromId(pathToImage)}`);
};

const watchPrefsFileAndUpdateWallpapers = (prefsFile) => {
  const watcher = new Watcher(prefsFile, { persistent: true, interval: 1000 });
  watcher.on("change", async () => {
    const prefsContent = fs.readFileSync(prefsFile, "utf-8");
    const spaceIdMatch = prefsContent.match(
      /user_pref\("zen.workspaces.active", "([^"]+)"\);/,
    );
    if (spaceIdMatch && spaceIdMatch[1]) {
      const activeSpaceId = spaceIdMatch[1];
      await setWallpaperForSpace(activeSpaceId);
    }
  });
};

const moveFileToWallpapersDir = (filePath, id) => {
  const wallpapersDir = path.join(__dirname, ".wallpapers");
  if (!fs.existsSync(wallpapersDir)) {
    fs.mkdirSync(wallpapersDir);
  }
  const destPath = path.join(wallpapersDir, getFileNameFromId(id));
  fs.copyFileSync(filePath, destPath);
  return destPath;
};

const runWithProfile = async (profileName) => {
  const profilePath = path.join(zenGlobalFile, profileName);
  const prefsFile = path.join(profilePath, "prefs.js");
  const sessionFile = path.join(profilePath, "zen-sessions.jsonlz4");
  const sessionFileContent = decompressMozLZ4(fs.readFileSync(sessionFile));
  let oldWallpaper = await getWallpaper();
  moveFileToWallpapersDir(oldWallpaper, "default");

  whenExit(() => {
    setWallpaperForSpace("default");
    console.log("Restored old wallpaper.");
  });

  const spaces = sessionFileContent.spaces;
  // Ask for image path for each space
  inquirer
    .prompt([
      ...spaces.map((space, index) => ({
        type: "input",
        name: `space_${index}`,
        message: `Enter the image path for "${space.name}" (${space.uuid}) (Default current wallpaper):`,
        default: oldWallpaper,
      })),
    ])
    .then(async (answers) => {
      spaces.forEach((space, index) => {
        const imagePath = answers[`space_${index}`];
        const storedPath = moveFileToWallpapersDir(imagePath, space.uuid);
        space.wallpaperPath = storedPath;
        console.log(
          `Set wallpaper for space "${space.name}" to "${storedPath}"`,
        );
      });
      watchPrefsFileAndUpdateWallpapers(prefsFile);
      console.log("Watching for workspace changes...");
    });

  console.log("All wallpapers have been set.");
};

// Get all the folders inside the zenGlobalFile directory and
// make the user choose one of them
const availableProfiles = fs.readdirSync(zenGlobalFile).filter((file) => {
  return fs.statSync(path.join(zenGlobalFile, file)).isDirectory();
});
console.log("Available Zen Profiles:", availableProfiles);
inquirer
  .prompt([
    {
      type: "rawlist",
      name: "profile",
      message:
        "Select a Zen profile to use for wallpaper (about:support to see current profile):",
      choices: availableProfiles,
    },
  ])
  .then((answers) => {
    runWithProfile(answers.profile);
  });
