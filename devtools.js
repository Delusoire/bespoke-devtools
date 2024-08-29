/// Utils

function* genRevMap(map, id = []) {
	for (const [key, value] of Object.entries(map)) {
		nid = [...id, key];
		if (typeof value === "object") {
			yield* genRevMap(value, nid);
		} else {
			yield [value, nid];
		}
	}
}

function genRevMapCollect(map) {
	return Object.fromEntries(genRevMap(map));
}

function waitForElement(selector, parent = document, timeout = 1000) {
	const p = Promise.withResolvers();
	const element = parent.querySelector(selector);
	if (element) {
		p.resolve(element);
		return p.promise;
	}

	const observer = new MutationObserver(function (mutations) {
		for (const mutation of mutations) {
			if (mutation.type === "childList") {
				const element = parent.querySelector(selector);
				if (element) {
					p.resolve(element);
					observer.disconnect();
				}
				return;
			}
		}
	});

	if (timeout >= 0) {
		setTimeout(function () {
			observer.disconnect();
			p.reject(
				new Error(
					`Timeout of ${timeout} expired while waiting for element matching ${selector}`,
				),
			);
		}, timeout);
	}

	observer.observe(parent, { childList: true, subtree: true });

	return p.promise;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBit() {
	return new Int32Array(new Float32Array([Math.random()]).buffer)[0] & 0b1;
}

/// Patching Inspector

let elementsViewP, elementsViewObserver;
let stylesPanelP, stylesPanelObserver;

function patchElementsPanel(
	element,
	MAP_CSS_CLASS,
	classmapStorage,
	isRefresh = false,
) {
	function patchElementsViewClassAttribute(node) {
		let name, value;
		for (const child of node.children) {
			if (child.nodeType !== Node.ELEMENT_NODE) {
				continue;
			}
			if (child.classList.contains("webkit-html-attribute-name")) {
				name = child;
			} else if (child.classList.contains("webkit-html-attribute-value")) {
				value = child;
			}
		}
		if (name && value) {
			const nameText = name.textContent;
			const valueText = value.textContent;
			if (nameText === "class") {
				value.textContent = valueText.split(" ").map(MAP_CSS_CLASS).join(
					" ",
				);
			}
		}
	}

	function patchStylesPanelSelector(node) {
		const selector = node.textContent;
		node.textContent = selector.replaceAll(
			/\.[_a-zA-Z0-9]{20}\b/g,
			(s) => `.${MAP_CSS_CLASS(s.slice(1))}`,
		);
	}

	async function patchSidebar(sidebar) {
		if (
			sidebar.shadowRoot.querySelector(".tabbed-pane-header-tab.classmap")
		) {
			return;
		}

		const slider = await Promise.race([
			waitForElement(".tabbed-pane-tab-slider", sidebar.shadowRoot, -1),
			sleep(100),
		]);
		slider.classList.remove("enabled");

		const tabs = await Promise.race([
			waitForElement(".tabbed-pane-header-tabs", sidebar.shadowRoot, -1),
			sleep(100),
		]);
		const tab = document.createElement("div");

		function onOtherTabClick(e) {
			if (e.tab === tab) {
				return;
			}
			tab.classList.remove("selected");
			classmapStorage.remove();
		}

		function onTabClick(e) {
			e.tab = tab;
			const selectedTab = tabs.querySelector(
				".tabbed-pane-header-tab.selected",
			);
			if (selectedTab === tab) {
				return;
			}
			selectedTab?.classList.remove("selected");
			tab.classList.add("selected");
			sidebar.firstElementChild?.remove();
			sidebar.appendChild(classmapStorage);
		}

		tabs.addEventListener("click", onOtherTabClick);
		tab.className = "tabbed-pane-header-tab classmap";
		tab.addEventListener("click", onTabClick);
		const name = document.createElement("span");
		name.className = "tabbed-pane-header-tab-title";
		name.title = "";
		name.textContent = "Classmap";
		tab.appendChild(name);
		tabs.appendChild(tab);
	}

	function waitFor(fn, signal, cb) {
		let cancelled = false;
		signal.catch(() => cancelled = true);

		const v = fn();

		if (v) {
			cb(v);
		} else {
			setTimeout(() => {
				if (cancelled) {
					return;
				}
				waitFor(...arguments);
			}, 100);
		}
	}

	(async function () {
		elementsViewP?.reject();
		elementsViewObserver?.disconnect();
		elementsViewP = Promise.withResolvers();
		setTimeout(elementsViewP.reject, 3000);
		main = await Promise.race([
			elementsViewP.promise,
			waitForElement('[slot="insertion-point-main"]', element, -1),
		]);

		waitFor(
			() =>
				main.querySelector(".elements-wrap")?.firstElementChild?.shadowRoot,
			elementsViewP.promise,
			(elementsViewWrapper) => {
				elementsViewWrapper.querySelectorAll(".webkit-html-attribute")
					.forEach(
						patchElementsViewClassAttribute,
					);

				elementsViewObserver = new MutationObserver(function (mutations) {
					for (const mutation of mutations) {
						for (const node of mutation.addedNodes) {
							if (node.nodeType !== Node.ELEMENT_NODE) {
								continue;
							}
							if (node.classList.contains("webkit-html-attribute")) {
								patchElementsViewClassAttribute(node);
							} else {
								node.querySelectorAll(".webkit-html-attribute").forEach(
									patchElementsViewClassAttribute,
								);
							}
						}
					}
				});

				elementsViewObserver.observe(elementsViewWrapper, {
					childList: true,
					subtree: true,
				});
			},
		);
	})();

	(async function () {
		stylesPanelP?.reject();
		stylesPanelObserver?.disconnect();
		stylesPanelP = Promise.withResolvers();
		setTimeout(stylesPanelP.reject, 3000);
		const sidebar = await Promise.race([
			stylesPanelP.promise,
			waitForElement('[slot="insertion-point-sidebar"]', element, -1),
		]);

		if (!isRefresh) {
			patchSidebar(sidebar);
		}

		waitFor(
			() =>
				sidebar.querySelector(".style-panes-wrapper")?.firstElementChild
					?.shadowRoot,
			stylesPanelP.promise,
			(stylesPanelWrapper) => {
				stylesPanelWrapper.querySelectorAll(".simple-selector").forEach(
					patchStylesPanelSelector,
				);

				stylesPanelObserver = new MutationObserver(function (mutations) {
					for (const mutation of mutations) {
						for (const node of mutation.addedNodes) {
							if (node.nodeType !== Node.ELEMENT_NODE) {
								continue;
							}
							if (node.classList.contains("simple-selector")) {
								patchStylesPanelSelector(node);
							} else {
								node.querySelectorAll(".simple-selector").forEach(
									patchStylesPanelSelector,
								);
							}
						}
					}
				});

				stylesPanelObserver.observe(stylesPanelWrapper, {
					childList: true,
					subtree: true,
				});
			},
		);
	})();
}

/// JSON Storage

function normalizeJson(json) {
	return JSON.stringify(JSON.parse(json));
}

function prettyPrintJson(json) {
	return JSON.stringify(JSON.parse(json), null, 2);
}

class JsonStorage {
	constructor(wrapper, storageKey, onChange) {
		this.storageKey = storageKey;
		this.storedJson = null;
		this.onChange = onChange;
		this.applyStyles(wrapper);
		this.createStructure(wrapper);
		this.attachEventListeners();
		this.loadJson();
	}

	applyStyles(wrapper) {
		const style = document.createElement("style");
		style.textContent = `
       .json-storage {
         font-family: Arial, sans-serif;
         max-width: 600px;
         margin: 20px auto;
       }

       .json-storage__input {
         width: 100%;
         height: 150px;
         padding: 10px;
         margin-bottom: 10px;
         border: 1px solid #ccc;
         border-radius: 4px;
         resize: vertical;
       }

       .json-storage__buttons {
         margin-bottom: 10px;
       }

       .json-storage__button {
         padding: 10px 20px;
         margin-right: 10px;
         border: none;
         border-radius: 4px;
         cursor: pointer;
         font-size: 16px;
       }

       .json-storage__button--save {
         background-color: #4CAF50;
         color: white;
       }

       .json-storage__button--load {
         background-color: #008CBA;
         color: white;
       }

       .json-storage__output {
         padding: 10px;
         border: 1px solid #ccc;
         border-radius: 4px;
         min-height: 50px;
         white-space: pre-wrap;
       }
     `;
		wrapper.appendChild(style);
	}

	createStructure(wrapper) {
		const container = document.createElement("div");
		container.className = "json-storage";

		this.inputElement = document.createElement("textarea");
		this.inputElement.className = "json-storage__input";
		this.inputElement.placeholder = "Enter JSON here";

		const buttonsContainer = document.createElement("div");
		buttonsContainer.className = "json-storage__buttons";

		this.saveButton = document.createElement("button");
		this.saveButton.className =
			"json-storage__button json-storage__button--save";
		this.saveButton.textContent = "Save";

		this.loadButton = document.createElement("button");
		this.loadButton.className =
			"json-storage__button json-storage__button--load";
		this.loadButton.textContent = "Load";

		this.outputElement = document.createElement("div");
		this.outputElement.className = "json-storage__output";

		buttonsContainer.appendChild(this.saveButton);
		buttonsContainer.appendChild(this.loadButton);
		container.appendChild(this.inputElement);
		container.appendChild(buttonsContainer);
		container.appendChild(this.outputElement);

		wrapper.appendChild(container);
	}

	attachEventListeners() {
		this.saveButton.addEventListener("click", () => this.saveJson());
		this.loadButton.addEventListener("click", () => this.loadJson());
	}

	saveJson() {
		try {
			const jsonInput = this.inputElement.value;
			const storedJson = normalizeJson(jsonInput);
			localStorage.setItem(this.storageKey, storedJson);
			this.outputElement.textContent = "JSON saved successfully!";
			this.#onChange(storedJson);
		} catch (_) {
			this.outputElement.textContent = "Error: Invalid JSON";
		}
	}

	#onChange(storedJson) {
		if (this.storedJson === storedJson) {
			return;
		}
		this.storedJson = storedJson;
		this.onChange(JSON.parse(storedJson));
	}

	loadJson() {
		const storedJson = localStorage.getItem(this.storageKey);
		if (storedJson) {
			this.inputElement.value = prettyPrintJson(storedJson);
			this.outputElement.textContent = "JSON loaded successfully!";
			this.#onChange(storedJson);
		} else {
			this.outputElement.textContent = "No JSON found in localStorage";
		}
	}
}

/// init

async function init() {
	globalThis.MAP = null;
	globalThis.REV_MAP = null;
	globalThis.MAP_CSS_CLASS = (className) => className;

	function onClassmapChange(classmap) {
		globalThis.MAP = classmap;
		globalThis.REV_MAP = genRevMapCollect(classmap);
		globalThis.MAP_CSS_CLASS = function (className) {
			const ids = globalThis.REV_MAP?.[className];
			if (!ids) {
				return className;
			}
			return "MAP__" + ids.map((id) => id.replaceAll("_", "-")).join("__");
		};
	}

	const classmapStorageWrapper = document.createElement("div");
	const classmapStorage = new JsonStorage(
		classmapStorageWrapper,
		"classmap",
		onClassmapChange,
	);

	function patchElementsPanelSync(isRefresh) {
		const elementsPanel = main.querySelector('[aria-label="Elements panel"]');
		if (elementsPanel) {
			patchElementsPanel(
				elementsPanel,
				globalThis.MAP_CSS_CLASS,
				classmapStorageWrapper,
				isRefresh,
			);
		}
	}

	const main = await waitForElement(".main-tabbed-pane", document, -1);

	classmapStorage.onChange = (classmap) => {
		onClassmapChange(classmap);
		patchElementsPanelSync(true);
	};
	patchElementsPanelSync(false);

	const observer = new MutationObserver(function (mutations) {
		for (const mutation of mutations) {
			if (mutation.addedNodes.length > 0) {
				const element = mutation.addedNodes[0];
				if (element.ariaLabel === "Elements panel") {
					patchElementsPanel(
						element,
						globalThis.MAP_CSS_CLASS,
						classmapStorageWrapper,
					);
				}
			}
		}
	});

	observer.observe(main, { childList: true });
}

if (location.protocol === "devtools:") {
	init();
}
