if (location.protocol === "devtools:") {
   init();
}

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

globalThis.MAP_CSS_CLASS = function (x) {
   y = REV_MAP?.[x];
   if (!y) {
      return x;
   }
   return "MAP__" + y.map(i => i.replaceAll("_", "-")).join("__");
};

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
               return;
            }
         }
      }
   });

   if (timeout >= 0) {
      setTimeout(function () {
         observer.disconnect();
         p.reject(new Error(`Timeout of ${timeout} expired while waiting for element matching ${selector}`));
      }, timeout);
   }

   return p.promise;
}

let elementsViewObserver;
let stylesPanelObserver;

function patchElementsPanel(element) {
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
            value.textContent = valueText.split(" ").map(globalThis.MAP_CSS_CLASS).join(" ");
         }
      }
   }

   function patchStylesPanelSelector(node) {
      const selector = node.textContent;
      node.textContent = selector.replaceAll(/\.[_a-zA-Z0-9]{20}\b/g, s => `.${globalThis.MAP_CSS_CLASS(s.slice(1))}`);
   }

   elementsViewObserver?.disconnect();
   stylesPanelObserver?.disconnect();

   const elementsViewWrapper = element.querySelector(".elements-wrap").firstElementChild.shadowRoot;
   const stylesPanelWrapper = element.querySelector(".style-panes-wrapper").firstElementChild.shadowRoot;

   console.log(elementsViewWrapper);
   console.log(stylesPanelWrapper);

   elementsViewWrapper.querySelectorAll(".webkit-html-attribute").forEach(patchElementsViewClassAttribute);
   stylesPanelWrapper.querySelectorAll(".simple-selector").forEach(patchStylesPanelSelector);

   elementsViewObserver = new MutationObserver(function (mutations) {
      for (const mutation of mutations) {
         for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) {
               continue;
            }
            if (node.classList.contains("webkit-html-attribute")) {
               patchElementsViewClassAttribute(node);
            } else {
               node.querySelectorAll(".webkit-html-attribute").forEach(patchElementsViewClassAttribute);
            }
         }
      }
   });
   stylesPanelObserver = new MutationObserver(function (mutations) {
      for (const mutation of mutations) {
         for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) {
               continue;
            }
            if (node.classList.contains("simple-selector")) {
               patchStylesPanelSelector(node);
            } else {
               node.querySelectorAll(".simple-selector").forEach(patchStylesPanelSelector);
            }
         }
      }
   });

   elementsViewObserver.observe(elementsViewWrapper, { childList: true, subtree: true });
   stylesPanelObserver.observe(stylesPanelWrapper, { childList: true, subtree: true });
}

async function init() {
   // TODO: let user select classmap
   fetch("https://raw.githubusercontent.com/spicetify/classmaps/main/1020040/classmap-190747c4b8f.json")
      .then(x => x.json())
      .then(x => {
         globalThis.MAP = x;
         globalThis.REV_MAP = genRevMapCollect(globalThis.MAP);
      });

   // TODO remove this
   await new Promise(r => setTimeout(r, 3000));

   const main = await waitForElement(".main-tabbed-pane", document, -1);

   const elementsPanel = main.querySelector('[aria-label="Elements panel"]');
   if (elementsPanel) {
      patchElementsPanel(elementsPanel);
   }

   const observer = new MutationObserver(function (mutations) {
      for (const mutation of mutations) {
         if (mutation.addedNodes.length > 0) {
            const element = mutation.addedNodes[0];
            if (element.ariaLabel === "Elements panel") {
               patchElementsPanel(element);
            }
         }
      }
   });

   observer.observe(main, { childList: true });
}
