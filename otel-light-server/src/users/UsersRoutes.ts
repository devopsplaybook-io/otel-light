import { FastifyInstance, RequestGenericInterface } from "fastify";
import { User } from "../model/User";
import { OTelRequestSpan } from "../OTelContext";
import { AuthGenerateJWT, AuthGetUserSession } from "./Auth";
import {
  UserPasswordCheckPassword,
  UserPasswordSetPassword,
} from "./UserPassword";
import {
  UsersDataAdd,
  UsersDataGet,
  UsersDataGetByName,
  UsersDataList,
  UsersDataUpdate,
} from "./UsersData";

export class UsersRoutes {
  //

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/status/initialization", async (req, res) => {
      if ((await UsersDataList(OTelRequestSpan(req))).length === 0) {
        res.status(201).send({ initialized: false });
      } else {
        res.status(201).send({ initialized: true });
      }
    });

    interface PostSession extends RequestGenericInterface {
      Body: {
        name: string;
        password: string;
      };
    }
    fastify.post<PostSession>("/session", async (req, res) => {
      let user: User;
      // From token
      const userSession = await AuthGetUserSession(req);
      if (userSession.isAuthenticated) {
        user = await UsersDataGet(OTelRequestSpan(req), userSession.userId);
        return res
          .status(201)
          .send({ success: true, token: await AuthGenerateJWT(user) });
      }

      // From User/Pass
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      user = await UsersDataGetByName(OTelRequestSpan(req), req.body.name);
      if (!user) {
        return res.status(403).send({ error: "Authentication Failed" });
      } else if (
        await UserPasswordCheckPassword(
          OTelRequestSpan(req),
          user,
          req.body.password
        )
      ) {
        return res
          .status(201)
          .send({ success: true, token: await AuthGenerateJWT(user) });
      } else {
        return res.status(403).send({ error: "Authentication Failed" });
      }
    });

    interface PostUser extends RequestGenericInterface {
      Body: {
        name: string;
        password: string;
      };
    }
    fastify.post<PostUser>("/", async (req, res) => {
      let isInitialized = true;
      if ((await UsersDataList(OTelRequestSpan(req))).length === 0) {
        isInitialized = false;
      }
      const userSession = await AuthGetUserSession(req);
      if (isInitialized && !userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const newUser = new User();
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      if (await UsersDataGetByName(OTelRequestSpan(req), req.body.name)) {
        return res.status(400).send({ error: "Username Already Exists" });
      }
      newUser.name = req.body.name;
      await UserPasswordSetPassword(
        OTelRequestSpan(req),
        newUser,
        req.body.password
      );
      await UsersDataAdd(OTelRequestSpan(req), newUser);
      res.status(201).send({});
    });

    interface PutNewPassword extends RequestGenericInterface {
      Body: {
        password: string;
        passwordOld: string;
      };
    }
    fastify.put<PutNewPassword>("/password", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const user = await UsersDataGet(OTelRequestSpan(req), userSession.userId);
      if (!req.body.password || !req.body.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      if (
        !(await UserPasswordCheckPassword(
          OTelRequestSpan(req),
          user,
          req.body.passwordOld
        ))
      ) {
        return res.status(403).send({ error: "Old Password Wrong" });
      }
      await UserPasswordSetPassword(
        OTelRequestSpan(req),
        user,
        req.body.password
      );
      await UsersDataUpdate(OTelRequestSpan(req), user);
      res.status(201).send({});
    });
  }
}
