import { checkAuth } from "../auth";
import { LinearApiError, linearGraphQL } from "../client";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

const mockedLinearGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;

describe("checkAuth", () => {
  beforeEach(() => {
    mockedLinearGraphQL.mockReset();
  });

  it("returns the viewer on success", async () => {
    mockedLinearGraphQL.mockResolvedValue({
      viewer: {
        id: "user-1",
        name: "Matt Fancy",
        email: "matt@example.com"
      }
    });

    await expect(checkAuth()).resolves.toEqual({
      id: "user-1",
      name: "Matt Fancy",
      email: "matt@example.com"
    });
  });

  it("fails loudly when LINEAR_API_KEY is missing", async () => {
    mockedLinearGraphQL.mockRejectedValue(new Error("No LINEAR_API_KEY set. Set it via the linear-access skill."));

    await expect(checkAuth()).rejects.toThrow("No LINEAR_API_KEY set. Set it via the linear-access skill.");
  });

  it("fails loudly when the LINEAR_API_KEY is invalid", async () => {
    mockedLinearGraphQL.mockRejectedValue(new LinearApiError("Unauthorized", "UNAUTHORIZED"));

    await expect(checkAuth()).rejects.toThrow("LINEAR_API_KEY is invalid: Unauthorized");
  });
});
