import { User } from "../model/User";
import { UserPasswordCheckPassword, UserPasswordSetPassword } from "./UserPassword";

test("Password should be successfully verified if it's the same", async () => {
  const password = "testPassword1234";
  const user = new User();
  await UserPasswordSetPassword(null, user, password);
  expect(await UserPasswordCheckPassword(null, user, password)).toBeTruthy();
});

test("Password should be faile to be verified if it's not the same", async () => {
  const password = "testPassword1234";
  const passwordWrong = "testPassword12345";
  const user = new User();
  await UserPasswordSetPassword(null, user, password);
  expect(await UserPasswordCheckPassword(null, user, passwordWrong)).toBeFalsy();
});
