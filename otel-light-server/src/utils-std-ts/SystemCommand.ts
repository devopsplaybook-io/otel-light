import * as childProcess from "child_process";

export function SystemCommandExecute(command: string, options = {}): Promise<string> {
  const exec = childProcess.exec;
  return new Promise<string>((resolve, reject) => {
    exec(command, options, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}
