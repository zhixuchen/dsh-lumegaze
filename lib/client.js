window.__ModuleLoader__.load({ id: "dsh-lumegaze/client", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let react_jsx_runtime = require("react/jsx-runtime");
// src/client/locales.ts
/** 本插件拥有的字典 namespace。 */
const NS = "settings.lumegaze";
/** 简体中文文案。 */
const zh = {
	title: "观灵域行者",
	description: "观灵域行者 AI 网关：WebSocket 端口、服务端地址与行者人设。",
	pluginToggle: "插件总开关",
	pluginToggleHint: "启用或禁用整个插件：关闭会经宿主插件管理器停用本插件（面板随之消失，可从 DSH 插件管理器重新启用）；插件内 enabled 继续作为运行期 WS 网关兜底。",
	pluginToggleDisableConfirm: "确认禁用？宿主级禁用会卸载本插件，面板将消失，需从 DSH 插件管理器重新启用。",
	confirmDisable: "确认禁用",
	cancel: "取消",
	authSecret: "插件鉴权密钥",
	authSecretHint: "与观灵域客户端 token 输入框对应；留空表示 WS 握手不鉴权。保存后插件鉴权即时生效。",
	authSecretConfigured: "已配置",
	wsPort: "WebSocket 监听端口",
	wsPortHint: "仅绑定 127.0.0.1；留空使用默认 8790。",
	serverUrl: "游戏服务端 URL",
	serverUrlHint: "以 http(s):// 开头；留空表示不发起服务端 HTTP 交互。",
	serverUrlInvalid: "需以 http:// 或 https:// 开头。",
	personaPrompt: "行者通用人设 Prompt",
	personaPromptHint: "多行编辑；留空表示不追加额外人设。",
	memoryMode: "记忆模式",
	memoryModeLong: "已接入长期记忆",
	memoryModeShort: "短期记忆降级模式",
	dependency: "依赖状态",
	dependencyInstalled: "billion-context 已安装",
	dependencyMissing: "未安装（自动安装失败）",
	dependencyUnknown: "状态未知",
	switches: "用户开关状态",
	switchesEmpty: "暂无用户开关记录。",
	switchEnabled: "已开启",
	switchDisabled: "已关闭",
	logEnabled: "详细运行日志",
	logEnabledHint: "开启后输出更详细的运行日志。",
	overridden: "已覆盖",
	reset: "恢复默认",
	readOnly: "本部署的设置为只读。",
	unavailable: "该插件当前未加载，暂时无法配置。",
	save: "保存",
	saving: "保存中…",
	saveFailed: "保存未被接受，请修正后重试。",
	invalidNumber: "请填 1–65535 的整数。",
	loading: "加载中…",
	loadFailed: "配置加载失败，请重试。",
	retry: "重试"
};
/** English copy, checked complete against the zh key set. */
const en = {
	title: "Guanlingyu Walker",
	description: "Guanlingyu walker AI gateway: WebSocket port, server URL and walker persona.",
	pluginToggle: "Plugin master switch",
	pluginToggleHint: "Enable or disable the whole plugin: turning it off calls the host plugin manager to unload this plugin (the panel disappears; re-enable it from the DSH plugin manager). The in-plugin enabled flag remains the runtime WS gateway fallback.",
	pluginToggleDisableConfirm: "Disable? Host-level disabling unloads this plugin and the panel disappears; re-enable it from the DSH plugin manager.",
	confirmDisable: "Disable",
	cancel: "Cancel",
	authSecret: "Plugin auth secret",
	authSecretHint: "Matches the token field in the Guanlingyu client; leave blank to disable WS handshake auth. Takes effect immediately after saving.",
	authSecretConfigured: "Configured",
	wsPort: "WebSocket listen port",
	wsPortHint: "Bound to 127.0.0.1 only; leave blank for the default 8790.",
	serverUrl: "Game server URL",
	serverUrlHint: "Starts with http(s)://; blank means no server HTTP interaction.",
	serverUrlInvalid: "Must start with http:// or https://.",
	personaPrompt: "Walker persona prompt",
	personaPromptHint: "Multi-line; blank means no extra persona is appended.",
	memoryMode: "Memory mode",
	memoryModeLong: "Long-term memory connected",
	memoryModeShort: "Short-term memory fallback mode",
	dependency: "Dependency status",
	dependencyInstalled: "billion-context installed",
	dependencyMissing: "Not installed (automatic install failed)",
	dependencyUnknown: "Status unknown",
	switches: "Per-user switches",
	switchesEmpty: "No per-user switch records yet.",
	switchEnabled: "Enabled",
	switchDisabled: "Disabled",
	logEnabled: "Detailed runtime logs",
	logEnabledHint: "Emit more detailed runtime logs when enabled.",
	overridden: "Overridden",
	reset: "Reset to default",
	readOnly: "This deployment stores settings read-only.",
	unavailable: "This plugin is not loaded, so it cannot be configured right now.",
	save: "Save",
	saving: "Saving…",
	saveFailed: "The deployment did not accept these values; correct them and retry.",
	invalidNumber: "Enter an integer between 1 and 65535.",
	loading: "Loading…",
	loadFailed: "Failed to load the configuration; please retry.",
	retry: "Retry"
};
/** 表单框架文案（来自本页字典）。 */
function formLabels(t) {
	return {
		unavailable: t("unavailable"),
		readOnly: t("readOnly"),
		saveFailed: t("saveFailed"),
		save: t("save"),
		saving: t("saving")
	};
}
// src/client/LumegazeCard.tsx
/**
* Lumegaze 配置面板（DSH 插件内置设置页）。
*
* 覆盖规格第五章全部 7 项（插件总开关、WebSocket 端口、游戏服务端 URL（含格式校验）、
* 行者通用人设 Prompt（多行）、状态展示区（记忆模式 / 依赖状态）、用户开关只读列表、
* 日志开关），并追加 M3 插件鉴权密钥（write-only secret，对应客户端 token 输入框）。
* 运行态数据经 `ctx.configForms.get('lumegaze')` 读取，随 toggle 实时更新。
*/
const STYLE_ID = "dsh-lumegaze/LumegazeCard.module.css";
const CSS = `
.lumegaze-section{display:flex;flex-direction:column;gap:16px}
.lumegaze-row{display:flex;flex-direction:column;gap:6px}
.lumegaze-row-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.lumegaze-label{font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.lumegaze-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.lumegaze-state{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.lumegaze-textarea{width:100%;min-height:96px;padding:8px 10px;font:inherit;font-size:13px;line-height:1.5;resize:vertical;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-surface-primary,transparent);color:var(--dsw-alias-label-primary)}
.lumegaze-textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.lumegaze-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.lumegaze-status-cell{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px}
.lumegaze-status-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.lumegaze-status-value{font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.lumegaze-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.lumegaze-list-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.lumegaze-list-empty{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.lumegaze-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}
.lumegaze-confirm{margin-left:8px;padding:2px 10px;font:inherit;font-size:12px;line-height:18px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-surface-primary,transparent);color:var(--dsw-alias-label-primary);cursor:pointer}
.lumegaze-confirm:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
`;
/** 注入面板样式（幂等；与官方 settings 卡片同款 document.head 注入）。 */
function ensureStyles() {
	if (typeof document === "undefined") return;
	if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-lumegaze";
	tag.dataset.pluginCss = STYLE_ID;
	tag.textContent = CSS;
	document.head.appendChild(tag);
}
ensureStyles();
/** 依赖状态 → 标签色调（状态不只靠颜色：同时有文字）。 */
function dependencyTone(status) {
	if (status === "installed") return "success";
	if (status === "missing" || status === "failed" || status === "cancelled" || status === "overridden") return "danger";
	if (status === "installing" || status === "restart-required") return "warning";
	return "neutral";
}
/** 依赖状态 → 文案。 */
function dependencyLabel(t, status) {
	if (status === "installed") return t("dependencyInstalled");
	if (status === "missing" || status === "failed" || status === "cancelled" || status === "overridden") return t("dependencyMissing");
	return t("dependencyUnknown");
}
/**
* 渲染 Lumegaze 面板：一行摘要，或（view === 'page'）完整配置表单。
* @param props - 渲染器绑定的 view、本页字典与注册侧业务面。
*/
function LumegazeCard(props) {
	const { t } = props;
	const state = props.useLumegazeCard((snapshot) => snapshot);
	const [confirmingDisable, setConfirmingDisable] = (0, react.useState)(false);
	if (props.view === "summary") return t("description");
	if (state.status === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		className: "lumegaze-state",
		children: t("loading")
	});
	if (state.status === "unavailable" || !state.available) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		className: "lumegaze-state",
		children: t("unavailable")
	});
	const disabled = !state.writable || state.saving;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsForm, {
		labels: formLabels(t),
		state,
		onSave: props.save,
		onDiscard: props.discard,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
			className: "lumegaze-section",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "lumegaze-row",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "lumegaze-row-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "lumegaze-label",
								children: t("pluginToggle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
								checked: state.enabled.text === "true",
								onChange: (next) => {
									if (next) {
										setConfirmingDisable(false);
										props.edit("enabled", "true");
										props.setPluginEnabled(true);
									} else setConfirmingDisable(true);
								},
								label: t("pluginToggle"),
								disabled: disabled || state.enabled.invalid,
								title: disabled ? t("readOnly") : void 0
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "lumegaze-hint",
							children: t("pluginToggleHint")
						}),
						confirmingDisable ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "lumegaze-hint",
							children: [
								t("pluginToggleDisableConfirm"),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "lumegaze-confirm",
									onClick: () => {
										setConfirmingDisable(false);
										props.edit("enabled", "false");
										props.setPluginEnabled(false);
									},
									children: t("confirmDisable")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "lumegaze-confirm",
									onClick: () => setConfirmingDisable(false),
									children: t("cancel")
								})
							]
						}) : null
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsSecretField, {
					id: "plugin-config-lumegaze-auth-secret",
					label: t("authSecret"),
					hint: t("authSecretHint"),
					text: state.authSecret.text,
					disabled,
					onEdit: (text) => props.edit("authSecret", text),
					configured: state.authSecretConfigured,
					stateLabel: t("authSecretConfigured")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
					id: "plugin-config-lumegaze-ws-port",
					label: t("wsPort"),
					hint: state.wsPort.invalid ? t("invalidNumber") : t("wsPortHint"),
					overriddenLabel: t("overridden"),
					resetLabel: t("reset"),
					invalidLabel: t("invalidNumber"),
					numeric: true,
					placeholder: "8790",
					disabled,
					...state.wsPort,
					onEdit: (text) => props.edit("wsPort", text),
					onReset: () => props.resetField("wsPort")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
					id: "plugin-config-lumegaze-server-url",
					label: t("serverUrl"),
					hint: state.serverUrl.invalid ? t("serverUrlInvalid") : t("serverUrlHint"),
					overriddenLabel: t("overridden"),
					resetLabel: t("reset"),
					invalidLabel: t("serverUrlInvalid"),
					disabled,
					...state.serverUrl,
					onEdit: (text) => props.edit("serverUrl", text),
					onReset: () => props.resetField("serverUrl")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "lumegaze-row",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: "lumegaze-label",
							htmlFor: "plugin-config-lumegaze-persona",
							children: t("personaPrompt")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							id: "plugin-config-lumegaze-persona",
							className: "lumegaze-textarea",
							value: state.personaPrompt.text,
							placeholder: t("personaPromptHint"),
							disabled,
							"aria-invalid": state.personaPrompt.invalid || void 0,
							onChange: (event) => props.edit("personaPrompt", event.target.value)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "lumegaze-hint",
							children: t("personaPromptHint")
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "lumegaze-status",
					"aria-label": t("memoryMode"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "lumegaze-status-cell",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "lumegaze-status-label",
							children: t("memoryMode")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "lumegaze-status-value",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
								tone: state.memoryMode === "long" ? "success" : "warning",
								children: state.memoryMode === "long" ? t("memoryModeLong") : t("memoryModeShort")
							})
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "lumegaze-status-cell",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "lumegaze-status-label",
							children: t("dependency")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "lumegaze-status-value",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
								tone: dependencyTone(state.billionStatus),
								children: dependencyLabel(t, state.billionStatus)
							})
						})]
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "lumegaze-row",
					"aria-label": t("switches"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "lumegaze-label",
						children: t("switches")
					}), state.switches.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "lumegaze-list-empty",
						children: t("switchesEmpty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "lumegaze-list",
						children: state.switches.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: "lumegaze-list-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "lumegaze-mono",
								children: row.userId
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
								tone: row.enabled ? "success" : "neutral",
								children: row.enabled ? t("switchEnabled") : t("switchDisabled")
							})]
						}, row.userId))
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "lumegaze-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "lumegaze-row-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "lumegaze-label",
							children: t("logEnabled")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
							checked: state.logEnabled.text === "true",
							onChange: (next) => props.edit("logEnabled", next ? "true" : "false"),
							label: t("logEnabled"),
							disabled: disabled || state.logEnabled.invalid,
							title: disabled ? t("readOnly") : void 0
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "lumegaze-hint",
						children: t("logEnabledHint")
					})]
				})
			]
		})
	});
}
// src/client/server-url.ts
/** 解析一行 URL 草稿。 */
function parseServerUrlDraft(text) {
	const trimmed = text.trim();
	if (trimmed === "") return { kind: "clear" };
	if (!/^https?:\/\//i.test(trimmed)) return void 0;
	return {
		kind: "set",
		value: trimmed
	};
}
// src/client/lumegaze-card-controller.ts
/** 布尔字段：草稿只能是 `true` / `false`，空草稿视为非法。 */
function settingsBooleanField(field) {
	return {
		field,
		format: (value) => value === true ? "true" : value === false ? "false" : "",
		parse: (text) => {
			if (text === "true") return {
				kind: "set",
				value: true
			};
			if (text === "false") return {
				kind: "set",
				value: false
			};
		}
	};
}
/**
* URL 字段：空值清空（不发起服务端 HTTP 交互）；非空必须以 http(s):// 开头，
* 否则 `parse` 返回 undefined 使草稿非法、阻止保存（不落盘）。
*/
function settingsUrlField(field) {
	return {
		field,
		format: (value) => typeof value === "string" ? value : "",
		parse: (text) => parseServerUrlDraft(text)
	};
}
/**
* 鉴权密钥字段（M3）：与观灵域客户端 T7 的 token 输入框对应。
*
* 这是 write-only secret：草稿永远从空白开始（绝不回显已存密钥），保存时经
* `mutate` 原子写 `authSecret` volatile 字段；插件 WS 鉴权在每次握手读取该
* volatile 值，因此保存后即时生效。
*/
function settingsAuthSecretSpec(scope) {
	return {
		field: "authSecret",
		write: async (text) => {
			const revision = scope.getSnapshot().revision;
			return scope.mutate([{
				op: "set",
				path: ["authSecret"],
				value: text
			}], revision);
		}
	};
}
var LumegazeCardController = class {
	scope;
	form;
	store;
	/** S-M1-2：浏览器半 remote.pluginManager；未注入时宿主级调用降级为 false。 */
	pluginManager;
	/**
	* @param scope - `ctx.configForms.get('lumegaze')` 返回的共享配置表单。
	* @param pluginManager - `ctx.remote.pluginManager`（可选；缺省时宿主级启停不可用）。
	*/
	constructor(scope, pluginManager) {
		this.scope = scope;
		this.pluginManager = pluginManager;
		this.form = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scope, [
			settingsBooleanField("enabled"),
			(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("wsPort"),
			settingsUrlField("serverUrl"),
			(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("personaPrompt"),
			settingsBooleanField("logEnabled")
		], [settingsAuthSecretSpec(scope)]);
		this.store = this.form.bind(() => this.projection());
	}
	/** 由暂存表单与 namespace 快照重建面板状态。 */
	projection() {
		const snapshot = this.scope.getSnapshot();
		const value = snapshot.value;
		const switches = Object.entries(value?.walkerAiSwitches ?? {}).filter(([userId, enabled]) => userId.length > 0 && typeof enabled === "boolean").sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([userId, enabled]) => ({
			userId,
			enabled
		}));
		return {
			...this.form.shell(),
			status: snapshot.status,
			enabled: this.form.field("enabled"),
			wsPort: this.form.field("wsPort"),
			serverUrl: this.form.field("serverUrl"),
			personaPrompt: this.form.field("personaPrompt"),
			authSecret: this.form.field("authSecret"),
			authSecretConfigured: typeof value?.authSecret === "string" && value.authSecret.length > 0,
			logEnabled: this.form.field("logEnabled"),
			memoryMode: value?.memoryMode === "long" ? "long" : "short",
			billionStatus: typeof value?.billionStatus === "string" ? value.billionStatus : "unknown",
			switches
		};
	}
	/** 构建注册进 `plugins.item` 的业务面。 */
	inject() {
		return {
			hooks: { lumegazeCard: this.store },
			setPluginEnabled: (enabled) => this.hostSetPluginEnabled(enabled),
			...this.form.actions()
		};
	}
	/**
	* S-M1-2：宿主级启停。经 remote client 调 `pluginManager.setPluginEnabled`。
	*
	* 成功语义收紧为解包 `RemoteResult<ChangeResult>.value.application`：仅
	* `'applied'` 返回 true；`'restart-required'` / `'overridden'` / `'cancelled'` /
	* `'failed'` 与非对象 / 缺 `ok: true` 的异常契约一律记 `console.warn` 并返回
	* false，插件内 `enabled` 草稿（运行期 WS 网关兜底）不受影响，面板不崩溃。
	*/
	async hostSetPluginEnabled(enabled) {
		const manager = this.pluginManager;
		if (!manager || typeof manager.setPluginEnabled !== "function") {
			console.warn("[dsh-lumegaze] remote.pluginManager unavailable; host toggle skipped (in-plugin switch fallback)");
			return false;
		}
		try {
			const result = await manager.setPluginEnabled(PLUGIN_ENTRY_ID, enabled);
			if (result === null || typeof result !== "object") {
				console.warn("[dsh-lumegaze] setPluginEnabled returned non-object result:", result);
				return false;
			}
			const typed = result;
			if (typed.ok === false) {
				console.warn("[dsh-lumegaze] setPluginEnabled refused:", typed.error);
				return false;
			}
			if (typed.ok !== true) {
				console.warn("[dsh-lumegaze] setPluginEnabled result missing ok=true:", typed);
				return false;
			}
			if (typed.value?.application !== "applied") {
				console.warn("[dsh-lumegaze] setPluginEnabled not applied: application=%s (in-plugin switch fallback only)", typed.value?.application ?? "undefined");
				return false;
			}
			return true;
		} catch (error) {
			console.warn("[dsh-lumegaze] setPluginEnabled failed:", error);
			return false;
		}
	}
	/** 释放表单订阅。 */
	dispose() {
		this.form.dispose();
	}
};
/**
* S-M1-2：Loader entry id（见 `dsh.bundle.patch.yml`：`- id: lumagaze, name: dsh-lumegaze`）。
* 该 id 同时是本插件的 settings namespace；宿主级 `setPluginEnabled` 以它为键。
*/
const PLUGIN_ENTRY_ID = "lumegaze";
// src/client.ts
/** 浏览器半插件显示名。 */
const name = "dsh-lumegaze/client";
/**
* 浏览器半所需服务：
* - `slots`：注册设置面板槽位（`plugins.item`）；
* - `locale`：提供面板文案字典；
* - `configForms`：绑定本插件的 settings namespace（`lumegaze`）读写配置；
* - `remote`：S-M1-2 宿主级启停所需的 `ctx.remote.pluginManager` 远程命名空间；
* - `remote.pluginManager`：确保该命名空间已挂载后再加载本面板（官方 plugin-manager 客户端同款）。
*/
const inject = [
	"slots",
	"locale",
	"configForms",
	"remote",
	"remote.pluginManager"
];
/**
* 浏览器半入口。
*
* 注册 Lumegaze 配置面板：先注册中英文案字典，再绑定 `configForms`，最后在 Host
* 服务 `lumegaze` namespace 期间把面板注入 Plugins 页的 `plugins.item` 槽。
* 这里刻意不 import 任何跨插件运行时值（客户端 bundle 纯净性门禁），只保留类型；
* 运行态状态经 `configForms` 的 Config 值读取。
*/
function apply(ctx) {
	const t = ctx.locale.bind(NS);
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "ui-settings-lumegaze: dictionaries");
	const controller = new LumegazeCardController(ctx.configForms.get("lumegaze"), ctx.remote?.pluginManager);
	ctx.effect(() => () => controller.dispose(), "ui-settings-lumegaze: form subscriptions");
	ctx.effect(() => ctx.configForms.whileServed(["lumegaze"], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
		name: "plugins.item",
		id: "lumegaze",
		order: 50,
		label: () => t("title"),
		locale: NS,
		inject: () => controller.inject()
	}, LumegazeCard))), "ui-settings-lumegaze: page");
}
exports.apply = apply;
exports.inject = inject;
exports.name = name;

return module.exports;
}});
//# sourceMappingURL=client.js.map