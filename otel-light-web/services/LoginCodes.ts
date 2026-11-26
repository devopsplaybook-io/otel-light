import { createLoginCodeService } from "@devopsplaybook.io/common-web/services/LoginCodeService";
import { SERVER_URL } from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";
import { AuthenticationStore } from "~~/stores/AuthenticationStore";
import { ServicesStore } from "~~/stores/ServicesStore";

/**
 * Cross-device "login with a code" client. Requests use the app API prefix,
 * approvals carry the interactive session, and a redeemed code installs the
 * minted session exactly like the password login does.
 */
type LoginCodeSessionListener = () => void;

let sessionListener: LoginCodeSessionListener | null = null;

/**
 * The cards unmount as soon as the session makes the page authenticated, which
 * would drop their `approved` event. The page registers its post-login
 * navigation here so it still runs after onSession has finished.
 */
export function setLoginCodeSessionListener(
  listener: LoginCodeSessionListener,
): () => void {
  sessionListener = listener;
  return () => {
    if (sessionListener === listener) sessionListener = null;
  };
}

export const loginCodeService = createLoginCodeService({
  baseUrl: `${SERVER_URL}/users/login-codes`,
  getAuthHeader: () => AuthService.getAuthHeader(),
  onSession: async (token) => {
    AuthService.saveToken(token);
    await AuthenticationStore().refreshFromToken();
    ServicesStore().clear();
    sessionListener?.();
  },
});

export async function loginCodesAvailable(): Promise<boolean> {
  try {
    const capabilities = await loginCodeService.capabilities();
    return capabilities.enabled === true && capabilities.available === true;
  } catch {
    return false;
  }
}
