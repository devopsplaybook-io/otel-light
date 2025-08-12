import { Span } from "@opentelemetry/sdk-trace-base";
import * as bcrypt from "bcrypt";
import { User } from "../model/User";

export async function UserPasswordSetPassword(context: Span, user: User, password: string): Promise<void> {
  const salt = await bcrypt.genSalt(10);
  user.passwordEncrypted = await bcrypt.hash(password, salt);
}

export async function UserPasswordCheckPassword(context: Span, user: User, password: string): Promise<boolean> {
  return await bcrypt.compare(password, user.passwordEncrypted);
}
