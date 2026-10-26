import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PasswordField } from "./PasswordField";

function Harness() {
  const [value, setValue] = useState("");
  return <PasswordField label="Password" value={value} onChange={(e) => setValue(e.target.value)} />;
}

describe("password field", () => {
  it("reveals the typed password and hides it again", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");

    await user.type(input, "S3cretPass");
    expect(input).toHaveValue("S3cretPass");

    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("S3cretPass");

    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(input).toHaveAttribute("type", "password");
  });
});
