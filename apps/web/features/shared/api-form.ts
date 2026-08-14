export type FormNotice = Readonly<{ message: string; tone: "danger" | "success" | "warning" }>;

export async function sendJson(
  url: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body: unknown,
) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: window.location.origin,
    },
    method,
  });
  const payload = (await response.json()) as {
    code?: string;
    data?: unknown;
    detail?: string;
    errors?: readonly { message: string }[];
  };
  if (!response.ok) {
    const message =
      payload.code === "VERSION_CONFLICT"
        ? "记录已被其他页面更新。请刷新后重试；本次操作没有覆盖新版本。"
        : payload.errors?.map((issue) => issue.message).join("；") ||
          payload.detail ||
          "保存失败，请重试。";
    throw new Error(message);
  }
  return payload.data;
}
