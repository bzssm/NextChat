import { useAccessStore } from "../app/store";
import { isVisionModel } from "../app/utils";

describe("isVisionModel", () => {
  const originalNonVisionModels = useAccessStore.getState().nonVisionModels;

  beforeEach(() => {
    useAccessStore.setState({ nonVisionModels: "" });
  });

  afterEach(() => {
    useAccessStore.setState({ nonVisionModels: originalNonVisionModels });
  });

  test.each([
    "gpt-4o",
    "gpt-3.5-turbo",
    "gpt-4-turbo-preview",
    "claude-2",
    "claude-3-5-haiku-20241022",
    "regular-model",
    "",
  ])("排除名单为空时默认允许模型 %s 输入图片", (model) => {
    expect(isVisionModel(model)).toBe(true);
  });

  test.each(["gpt-4o", "gpt-3.5-turbo", "custom-model"])(
    "模型 %s 在排除名单中时禁用图片输入",
    (model) => {
      useAccessStore.setState({
        nonVisionModels: `another-model,${model}`,
      });

      expect(isVisionModel(model)).toBe(false);
      expect(isVisionModel("another-model")).toBe(false);
      expect(isVisionModel("unlisted-model")).toBe(true);
    },
  );

  test("忽略名单项两端的空白字符", () => {
    useAccessStore.setState({
      nonVisionModels: "  gpt-4o ,\n custom-model\t ",
    });

    expect(isVisionModel("gpt-4o")).toBe(false);
    expect(isVisionModel("custom-model")).toBe(false);
  });

  test("只精确匹配完整模型名，并区分大小写", () => {
    useAccessStore.setState({
      nonVisionModels: "gpt-4o,custom-model-v2",
    });

    expect(isVisionModel("gpt-4o")).toBe(false);
    expect(isVisionModel("gpt-4o-mini")).toBe(true);
    expect(isVisionModel("custom-model")).toBe(true);
    expect(isVisionModel("GPT-4o")).toBe(true);
  });

  test("忽略重复逗号和空白名单项", () => {
    useAccessStore.setState({
      nonVisionModels: " ,gpt-4o,,gpt-4o, ,",
    });

    expect(isVisionModel("gpt-4o")).toBe(false);
    expect(isVisionModel("unlisted-model")).toBe(true);
    expect(isVisionModel("")).toBe(true);
  });

  test("每次判断均读取 Store 中最新的排除名单", () => {
    expect(isVisionModel("gpt-4o")).toBe(true);

    useAccessStore.setState({ nonVisionModels: "gpt-4o" });
    expect(isVisionModel("gpt-4o")).toBe(false);

    useAccessStore.setState({ nonVisionModels: "" });
    expect(isVisionModel("gpt-4o")).toBe(true);
  });
});
