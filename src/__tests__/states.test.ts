import { linearGraphQL } from "../client";
import { findStateByName } from "../states";

jest.mock("../client", () => ({
  ...jest.requireActual("../client"),
  linearGraphQL: jest.fn()
}));

const mockedLinearGraphQL = linearGraphQL as jest.MockedFunction<typeof linearGraphQL>;

const states = [
  { id: "1", name: "Todo" },
  { id: "2", name: "In Progress" },
  { id: "3", name: "Needs Review" },
  { id: "4", name: "Done" },
  { id: "5", name: "Blocked" },
  { id: "6", name: "Custom State" }
];

describe("findStateByName", () => {
  beforeEach(() => {
    mockedLinearGraphQL.mockReset();
    mockedLinearGraphQL.mockResolvedValue({
      team: {
        states: {
          nodes: states
        }
      }
    });
  });

  it.each([
    ["review", "Needs Review"],
    ["done", "Done"],
    ["progress", "In Progress"],
    ["todo", "Todo"],
    ["blocked", "Blocked"]
  ])("resolves alias %s to %s", async (alias, expectedName) => {
    await expect(findStateByName("team-1", alias)).resolves.toEqual(
      expect.objectContaining({ name: expectedName })
    );
  });

  it("falls back to exact match when alias is not recognized", async () => {
    await expect(findStateByName("team-1", "Custom State")).resolves.toEqual(
      expect.objectContaining({ name: "Custom State" })
    );
  });
});
