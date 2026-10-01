import { Launcher } from "@wdio/cli";

const launcher = new Launcher("./wdio.conf.ts", {
  capabilities: [
    {
      browserName: "chrome",
      "wdio:exclude": [
        "./src/components/__tests__/ProseMirror.mobile.test.tsx",
      ],
      "goog:chromeOptions": {
        args: ["--headless=new", "--js-flags=--expose-gc"],
      },
    },
  ],
  ...(process.argv[2] ? { specs: [process.argv[2]] } : {}),
});
process.exitCode = await launcher.run();
