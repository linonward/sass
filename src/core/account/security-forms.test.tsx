import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import en from "../../../messages/en.json";

import { ChangeEmailForm } from "./security-forms";

// Better Auth's client is faked: this locks down the form's own flow (which endpoint each step
// calls, with what, and what an error leaves on screen). The endpoints themselves are exercised in
// e2e/email-change.spec.ts.
const sendVerificationOtp = vi.fn();
const requestEmailChange = vi.fn();
const changeEmail = vi.fn();
vi.mock("@/core/auth/client", () => ({
  authClient: {
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => sendVerificationOtp(...args),
      requestEmailChange: (...args: unknown[]) => requestEmailChange(...args),
      changeEmail: (...args: unknown[]) => changeEmail(...args),
    },
  },
}));
vi.mock("./actions", () => ({
  signOutDevice: vi.fn(),
  signOutOtherDevices: vi.fn(),
}));

const e = en.Account.email;
const ok = { data: { success: true }, error: null };

function renderForm(verifyCurrentEmail = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ChangeEmailForm
        currentEmail="me@example.com"
        verifyCurrentEmail={verifyCurrentEmail}
        resendCooldown={60}
        signInHref="/sign-in"
      />
    </NextIntlClientProvider>,
  );
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

afterEach(() => {
  for (const mock of [sendVerificationOtp, requestEmailChange, changeEmail])
    mock.mockReset();
});

describe("ChangeEmailForm", () => {
  test("with verifyCurrentEmail: current code, then new code, then sign in again", async () => {
    sendVerificationOtp.mockResolvedValue(ok);
    requestEmailChange.mockResolvedValue(ok);
    changeEmail.mockResolvedValue(ok);
    renderForm();

    type(e.newLabel, " New@Example.com ");
    submit(e.continue);
    await screen.findByLabelText(e.currentCodeLabel);
    expect(sendVerificationOtp).toHaveBeenCalledWith({
      email: "me@example.com",
      type: "email-verification",
    });

    type(e.currentCodeLabel, "111111");
    submit(e.continue);
    await screen.findByLabelText(e.newCodeLabel);
    expect(requestEmailChange).toHaveBeenCalledWith({
      newEmail: "new@example.com",
      otp: "111111",
    });

    type(e.newCodeLabel, "222222");
    submit(e.confirm);
    await screen.findByRole("status");
    expect(changeEmail).toHaveBeenCalledWith({
      newEmail: "new@example.com",
      otp: "222222",
    });
    expect(screen.getByRole("status").textContent).toBe(
      e.done.replace("{email}", "new@example.com"),
    );
    expect(
      screen.getByRole("link", { name: e.signIn }).getAttribute("href"),
    ).toBe("/sign-in");
  });

  test("without verifyCurrentEmail the new address gets the only code", async () => {
    requestEmailChange.mockResolvedValue(ok);
    renderForm(false);

    type(e.newLabel, "new@example.com");
    submit(e.continue);
    await screen.findByLabelText(e.newCodeLabel);
    expect(sendVerificationOtp).not.toHaveBeenCalled();
    expect(requestEmailChange).toHaveBeenCalledWith({
      newEmail: "new@example.com",
    });
  });

  test("a wrong code keeps what was typed and says why", async () => {
    sendVerificationOtp.mockResolvedValue(ok);
    requestEmailChange.mockResolvedValue({
      data: null,
      error: { code: "INVALID_OTP", status: 400 },
    });
    renderForm();

    type(e.newLabel, "new@example.com");
    submit(e.continue);
    await screen.findByLabelText(e.currentCodeLabel);
    type(e.currentCodeLabel, "999999");
    submit(e.continue);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        en.Auth.errors.invalidCode,
      ),
    );
    expect(
      (screen.getByLabelText(e.currentCodeLabel) as HTMLInputElement).value,
    ).toBe("999999");
  });

  test("the current address and malformed addresses are refused before any request", async () => {
    renderForm();

    type(e.newLabel, "ME@example.com");
    submit(e.continue);
    expect(screen.getByRole("alert").textContent).toBe(e.same);

    // Passes the input's native type="email" check but has no dot in the domain.
    type(e.newLabel, "me@localhost");
    submit(e.continue);
    expect(screen.getByRole("alert").textContent).toBe(
      en.Auth.errors.invalidEmail,
    );
    expect(sendVerificationOtp).not.toHaveBeenCalled();
    expect(requestEmailChange).not.toHaveBeenCalled();
  });

  test("a resend cooldown shows the server's remaining seconds", async () => {
    sendVerificationOtp.mockResolvedValue({
      data: null,
      error: { code: "RESEND_COOLDOWN", status: 429, retryAfter: 42 },
    });
    renderForm();

    type(e.newLabel, "new@example.com");
    submit(e.continue);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        en.Auth.errors.cooldown.replace("{seconds}", "42"),
      ),
    );
  });
});
