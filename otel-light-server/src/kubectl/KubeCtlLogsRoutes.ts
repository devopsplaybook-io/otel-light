import { FastifyInstance, RequestGenericInterface } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { SystemCommandExecute } from "../utils-std-ts/SystemCommand";

export class KubeCtlLogsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    interface PostCommand extends RequestGenericInterface {
      Body: {
        namespace?: string;
        pod: string;
        container?: string;
        argument?: string;
      };
    }
    fastify.post<PostCommand>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.pod || req.body.pod.indexOf(" ") >= 0) {
        return res.status(400).send({ error: "Malformed Request" });
      }
      if (!req.body.namespace || req.body.namespace.indexOf(" ") >= 0) {
        return res.status(400).send({ error: "Malformed Request" });
      }
      if (req.body.container && req.body.container.indexOf(" ") >= 0) {
        return res.status(400).send({ error: "Malformed Request" });
      }
      if (
        req.body.argument &&
        (req.body.argument.indexOf(";") >= 0 ||
          req.body.argument.indexOf("&") >= 0 ||
          req.body.argument.indexOf("\\") >= 0)
      ) {
        return res.status(400).send({ error: "Malformed Request" });
      }
      const podArg = req.body.pod;
      const namespaceArg = req.body.namespace ? `-n ${req.body.namespace}` : "";
      const argumentArg = req.body.argument ? req.body.argument : "";
      const kubectlCommand = `kubectl logs ${namespaceArg} ${podArg} ${argumentArg} --timestamps`;
      const commandOutput = await SystemCommandExecute(
        `${kubectlCommand} | gzip | base64 -w 0`,
        {
          timeout: 20000,
          maxBuffer: 1024 * 1024 * 10,
        }
      );
      return res.status(201).send({ result: commandOutput });
    });
  }
}
