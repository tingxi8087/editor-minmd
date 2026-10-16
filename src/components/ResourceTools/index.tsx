import { useEffect, useState } from "react";
import { Button, Input, Modal } from "paper-ink";
import { IconLink, IconPhoto } from "paper-ink/icons";
import { rebaseReference, validLink } from "@/lib/resources";
import type { WorkspaceModel } from "@/workspace/model";
import "./style.less";

export default function ResourceTools({
  workspace,
}: {
  workspace: WorkspaceModel;
}) {
  const [dialog, setDialog] = useState<{
    id: string;
    from: number;
    to: number;
  } | null>(null);
  const [href, setHref] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const tab = workspace.active;
  const editor = tab?.editor;
  const enabled = !!editor?.isEditable && !workspace.busy && !workspace.closing;
  const open = () => {
    if (!enabled || !tab || !editor) return;
    const { from, to } = editor.state.selection;
    setDialog({ id: tab.id, from, to });
    setHref(
      rebaseReference(
        String(editor.getAttributes("link").href ?? ""),
        tab.resourceBase ?? "",
        tab.path ?? tab.resourceBase ?? "",
      ),
    );
    setText(editor.state.doc.textBetween(from, to, " "));
    setError("");
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey
      ) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  useEffect(() => {
    setDialog(null);
  }, [workspace.activeId]);
  const apply = () => {
    if (!editor || !dialog || dialog.id !== tab?.id) return;
    const input = href.trim();
    const value =
      tab.path && tab.resourceBase
        ? rebaseReference(input, tab.path, tab.resourceBase)
        : input;
    if (!validLink(value)) {
      setError("请输入网页地址、相对文件路径或 #标题锚点");
      return;
    }
    const chain = editor
      .chain()
      .focus()
      .setTextSelection({ from: dialog.from, to: dialog.to });
    if (dialog.from === dialog.to && !editor.isActive("link"))
      chain
        .insertContent({
          type: "text",
          text: text || value,
          marks: [{ type: "link", attrs: { href: value } }],
        })
        .run();
    else chain.extendMarkRange("link").setLink({ href: value }).run();
    setDialog(null);
  };
  return (
    <>
      <span className="tool-divider" />
      <button
        className={`format-button ${editor?.isActive("link") ? "active" : ""}`}
        aria-label="编辑链接"
        title="插入 / 编辑链接 · ⌘/Ctrl K"
        disabled={!enabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={open}
      >
        <IconLink size={17} stroke={1.65} />
      </button>
      <button
        className="format-button"
        aria-label="插入图片"
        title="插入本地图片，也可粘贴或拖入图片"
        disabled={!enabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (tab) void workspace.insertImages(tab.id);
        }}
      >
        <IconPhoto size={17} stroke={1.65} />
      </button>
      <Modal
        open={!!dialog}
        title="链接"
        width={440}
        onCancel={() => setDialog(null)}
        footer={
          <div className="link-actions">
            {editor?.isActive("link") && (
              <Button
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .unsetLink()
                    .run();
                  setDialog(null);
                }}
              >
                移除链接
              </Button>
            )}
            <Button
              disabled={!validLink(href.trim())}
              onClick={() => {
                if (tab) {
                  void workspace.openLink(
                    tab.id,
                    tab.path && tab.resourceBase
                      ? rebaseReference(href.trim(), tab.path, tab.resourceBase)
                      : href.trim(),
                  );
                  setDialog(null);
                }
              }}
            >
              打开链接
            </Button>
            <Button type="primary" onClick={apply}>
              应用
            </Button>
          </div>
        }
      >
        <div className="link-fields">
          {dialog?.from === dialog?.to && !editor?.isActive("link") && (
            <label>
              显示文字
              <Input
                aria-label="链接文字"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="留空则显示地址"
              />
            </label>
          )}
          <label>
            链接地址
            <Input
              autoFocus
              aria-label="链接地址"
              value={href}
              onChange={(e) => {
                setHref(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              placeholder="https://… 或 ../笔记.md#标题"
            />
          </label>
          <p>编辑时 ⌘ / Ctrl + 点击打开；阅读模式直接点击。</p>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
