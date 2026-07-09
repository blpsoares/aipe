import "./setup";
import { test, expect } from "bun:test";
import { render } from "@testing-library/preact";

function Hello({ name }: { name: string }) {
  return <div>Hello {name}</div>;
}

test("preact renders in happy-dom", () => {
  const { getByText } = render(<Hello name="AIPe" />);
  expect(getByText("Hello AIPe")).toBeTruthy();
});
