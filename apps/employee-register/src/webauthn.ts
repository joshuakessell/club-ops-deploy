/**
 * WebAuthn client utilities for passkey authentication.
 */

const API_BASE = '/api';

export interface RegistrationOptions {
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: Array<{ type: string; alg: number }>;
  timeout: number;
  attestation: string;
  excludeCredentials?: Array<{ id: string; type: string; transports?: string[] }>;
  authenticatorSelection?: {
    authenticatorAttachment?: string;
    userVerification: string;
  };
}

export interface AuthenticationOptions {
  challenge: string;
  timeout: number;
  rpId: string;
  allowCredentials?: Array<{ id: string; type: string; transports?: string[] }>;
  userVerification: string;
}

/**
 * Request registration options from the server.
 */
export async function requestRegistrationOptions(
  staffId: string,
  deviceId: string
): Promise<RegistrationOptions> {
  const response = await fetch(`${API_BASE}/v1/auth/webauthn/registration/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffId, deviceId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get registration options');
  }

  return response.json();
}

/**
 * Create a credential using WebAuthn API.
 */
export async function createCredential(
  options: RegistrationOptions
): Promise<PublicKeyCredential> {
  // Convert base64url challenge to ArrayBuffer
  const challengeBuffer = Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  // Convert user ID to ArrayBuffer
  const userIdBuffer = Uint8Array.from(atob(options.user.id.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  // Convert excludeCredentials IDs if present
  const excludeCredentials = options.excludeCredentials?.map(cred => ({
    ...cred,
    id: Uint8Array.from(atob(cred.id.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
  }));

  const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
    challenge: challengeBuffer.buffer,
    rp: options.rp,
    user: {
      id: userIdBuffer.buffer,
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    attestation: options.attestation,
    excludeCredentials,
    authenticatorSelection: options.authenticatorSelection,
  };

  const credential = await navigator.credentials.create({
    publicKey: publicKeyCredentialCreationOptions,
  }) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Failed to create credential');
  }

  return credential;
}

/**
 * Convert credential to JSON format for sending to server.
 */
export function credentialToJSON(credential: PublicKeyCredential): {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
  };
  type: string;
} {
  const response = credential.response as AuthenticatorAttestationResponse;

  return {
    id: credential.id,
    rawId: arrayBufferToBase64URL(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64URL(response.clientDataJSON),
      attestationObject: arrayBufferToBase64URL(response.attestationObject),
    },
    type: credential.type,
  };
}

/**
 * Request authentication options from the server.
 */
export async function requestAuthenticationOptions(
  staffLookup: string,
  deviceId: string
): Promise<AuthenticationOptions> {
  const response = await fetch(`${API_BASE}/v1/auth/webauthn/authentication/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffLookup, deviceId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get authentication options');
  }

  return response.json();
}

/**
 * Get a credential using WebAuthn API.
 */
export async function getCredential(
  options: AuthenticationOptions
): Promise<PublicKeyCredential> {
  // Convert base64url challenge to ArrayBuffer
  const challengeBuffer = Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  // Convert allowCredentials IDs if present
  const allowCredentials = options.allowCredentials?.map(cred => ({
    ...cred,
    id: Uint8Array.from(atob(cred.id.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
  }));

  const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
    challenge: challengeBuffer.buffer,
    timeout: options.timeout,
    rpId: options.rpId,
    allowCredentials,
    userVerification: options.userVerification as UserVerificationRequirement,
  };

  const credential = await navigator.credentials.get({
    publicKey: publicKeyCredentialRequestOptions,
  }) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Failed to get credential');
  }

  return credential;
}

/**
 * Convert authentication credential to JSON format for sending to server.
 */
export function authenticationCredentialToJSON(credential: PublicKeyCredential): {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
  type: string;
} {
  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    id: credential.id,
    rawId: arrayBufferToBase64URL(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64URL(response.clientDataJSON),
      authenticatorData: arrayBufferToBase64URL(response.authenticatorData),
      signature: arrayBufferToBase64URL(response.signature),
      userHandle: response.userHandle ? arrayBufferToBase64URL(response.userHandle) : null,
    },
    type: credential.type,
  };
}

/**
 * Verify registration with the server.
 */
export async function verifyRegistration(
  staffId: string,
  deviceId: string,
  credentialResponse: ReturnType<typeof credentialToJSON>
): Promise<{ verified: boolean; credentialId: string }> {
  const response = await fetch(`${API_BASE}/v1/auth/webauthn/registration/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffId, deviceId, credentialResponse }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Registration verification failed');
  }

  return response.json();
}

/**
 * Verify authentication with the server.
 */
export async function verifyAuthentication(
  deviceId: string,
  credentialResponse: ReturnType<typeof authenticationCredentialToJSON>
): Promise<{
  verified: boolean;
  staffId: string;
  name: string;
  role: string;
  sessionToken: string;
}> {
  const response = await fetch(`${API_BASE}/v1/auth/webauthn/authentication/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, credentialResponse }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Authentication verification failed');
  }

  return response.json();
}

/**
 * Check if WebAuthn is supported in this browser.
 */
export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined' &&
    typeof navigator.credentials.create !== 'undefined' &&
    typeof navigator.credentials.get !== 'undefined';
}

/**
 * Helper to convert ArrayBuffer to base64url string.
 */
function arrayBufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}









