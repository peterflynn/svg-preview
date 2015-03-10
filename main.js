/*
 * Copyright (c) 2012 Adobe Systems Incorporated.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50, regexp: true */
/*global define, brackets, $ */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var MainViewManager         = brackets.getModule("view/MainViewManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        WorkspaceManager        = brackets.getModule("view/WorkspaceManager"),
        ExtensionUtils          = brackets.getModule("utils/ExtensionUtils");
    
    // Extension's own modules
    var XMLPathFinder           = require("XMLPathFinder");
    
    // TODO:
    //  - source->image linkage -- blink element in SVG (if Live Highlight is toggled on)
    //      - blink element's fill red/normal/red/normal a few times when cursor enters its text bounds
    //      - (during NON-EDIT cursor movement only... how to detect??)
    
    /**
     * Preview panel that appears above the editor area. Lazily created, so may be null if never shown yet.
     * @type {?jQuery}
     */
    var $svgPanel;
    
    /** @type {boolean}  True if panel has just been shown/hidden */
    var needsWorkspaceLayout;
    
    /** @type {?Editor} */
    var currentEditor;
    
    /** State of the panel for the currently viewed Document, or null if panel not currently shown
     *  @type {?{zoomFactor:number}} */
    var currentState;
    
    
    function attrToPx(attrValue) {
        // Conversion factor for all CSS length units (other than percentage / viewport).
        // Just for estimation -- Makes assumptions about font metrics.
        var unitsToPixels = {
            cm : (96 / 2.54),
            mm : (96 / 25.4),
            "in" : 96,
            px : 1,
            pt : 96 / 72,
            pc : 96 / 12,
            em : 16,
            ex : 8,
            ch : 8,
            rem : 16
        };
        var number = parseFloat(attrValue);
        var unit = attrValue.match(/[a-z%]+/);
        if (unit) {
            // If unit not supported, this yields NaN which is fasly, so value is ignored below
            number *= unitsToPixels[unit[0]];
        }
        return number;
    }
    
    function limitDecimals(num, nDecimals) {
        return parseFloat(num.toFixed(nDecimals));
    }
    
    function setPanelHeight(height) {
        if (height !== $svgPanel.lastHeight || needsWorkspaceLayout) {
            $svgPanel.height(height);
            $svgPanel.lastHeight = height;
            
            WorkspaceManager.recomputeLayout();
            needsWorkspaceLayout = false;
        }
    }
    
    function updateSize($svgParent, $svgRoot) {
        // Get "natural" size of the SVG image, which is explicitly specified on the root tag:
        // 1) If width/height fully specified, that is the intended size. (If viewBox also specified
        //    with different size, the file effectively has a top-level scale factor).
        // 2) If viewBox specified with no width/height, assume that's the intended size (though
        //    browsers generally jump to 100% in this case).
        // 3) If viewBox specified and ONE of width/height specified, pick the other one to match the
        //    viewBox's aspect ratio (FF does this, but not Chrome).
        // 4) If no viewBox and width/height not fully specified, default missing dimension(s) to 200.
        var svgWidth, svgHeight;
        var svgWidthAttr  = $svgRoot.attr("width");
        var svgHeightAttr = $svgRoot.attr("height");
        var viewBoxAttr   = $svgRoot[0].getAttribute("viewBox");  // jQ can't read this attr - see below
        
        if (svgWidthAttr) {
            svgWidth = attrToPx(svgWidthAttr);
        }
        if (svgHeightAttr) {
            svgHeight = attrToPx(svgHeightAttr);
        }
        if (viewBoxAttr) {
            var bounds = viewBoxAttr.split(/[ ,]+/).map(parseFloat);
            if (!svgWidth) {
                svgWidth = svgHeight ? svgHeight * bounds[2] / bounds[3]
                            : bounds[2];
            }
            if (!svgHeight) {
                svgHeight = svgWidth ? svgWidth * bounds[3] / bounds[2]
                            : bounds[3];
            }
        }
        // If either has not been defined, or is zero or NaN, use defaults
        svgWidth  = svgWidth  || 200;
        svgHeight = svgHeight || 200;
        
        
        // Set actual display size consistent with zoom factor
        var viewWidth = svgWidth * currentState.zoomFactor;
        var viewHeight = svgHeight * currentState.zoomFactor;

        // Clip to max of 3/4 window ht
        var maxHeight = $(".content").height() * 3 / 4;
        if (viewHeight > maxHeight) {
            viewHeight = maxHeight;
            viewWidth = maxHeight * svgWidth / svgHeight;
        }
        $(".svg-tb-button.zoom11-icon", $svgPanel).toggleClass("disabled", svgHeight > maxHeight);
        $(".svg-tb-button.zoomin-icon", $svgPanel).toggleClass("disabled", viewHeight * 2 > maxHeight);
        
        $(".svg-tb-label", $svgPanel).text(limitDecimals((viewWidth / svgWidth) * 100, 2) + "%");
        
        // jQ auto lowercases the attr name, making it ignored (http://bugs.jquery.com/ticket/11166 wontfix: "we don't support SVG")
        if (!viewBoxAttr) {
            // Ensure we always have a viewBox, so our zoom scales instead of just growing the crop region
            $svgRoot[0].setAttribute("viewBox", "0 0 " + svgWidth + " " + svgHeight);
        }
        $svgRoot.attr("width", viewWidth);
        $svgRoot.attr("height", viewHeight);
        
        
        var desiredPanelHeight = $(".svg-toolbar", $svgPanel).outerHeight() + viewHeight + (15 * 2);
        setPanelHeight(desiredPanelHeight);
        
        $svgParent.width(viewWidth);
        $svgParent.height(viewHeight);
    }
    
    /**
     * Re-renders the SVG preview in the panel, automatically sizing it (and the overall panel) to
     * reflect the explicitly set size of the SVG content (modulo the current zoom).
     */
    function updatePanel(editor) {
        var $svgParent = $(".svg-preview", $svgPanel);
        $svgParent.html(editor.document.getText());
        var $svgRoot = $svgParent.children();
        
        if (!$svgRoot.length) {  // empty document
            return;
        }
        
        updateSize($svgParent, $svgRoot);
    }
    
    
    /** Clicking in SVG content selects the corresponding tag in the code */
    function handleSVGClick(event) {
        // Figure out what was clicked
        var clickedNode = event.target;
        if (clickedNode.correspondingUseElement) {
            // If it's an instantiation of a <defs> item, let's target the <use> (aka the instance)
            // (TODO: option to target the node inside <defs> instead, via correspondingElement)
            clickedNode = clickedNode.correspondingUseElement;
        }
        
        // Generate ancestor chain of the clicked node
        var nodeChain = [];
        var svgRoot = event.currentTarget;
        var node = clickedNode;
        while (node && node !== svgRoot) {
            nodeChain.unshift(node);
            node = node.parentElement;
        }
//        console.log("CLICK on", event.target);
//        console.log("nodeChain =", nodeChain);
        
        // Generate nth-child lookup info
        var chain = [];
        nodeChain.forEach(function (node) {
            var childIndex = $(node).index();
            chain.push({ childIndex: childIndex, tagName: node.tagName });
            
//            console.log(node.tagName + ", child #" + childIndex);
        });
        
        // Find that same tag in the code
        var startOfOpenTag = XMLPathFinder.findTag(currentEditor, chain);
        if (startOfOpenTag) {
            // Select it
            var lineNum = startOfOpenTag.pos.line;
            var token = startOfOpenTag.token;
            currentEditor.setSelection({line: lineNum, ch: token.start}, {line: lineNum, ch: token.end}, true);
        }
    }
    
    
    function populateToolbar($svgToolbar) {
        var html = "";
        
        html += "<div class='svg-bgswatch checker' title='Checkerboard'></div>";
        html += "<div class='svg-bgswatch' style='background-color:white' title='#FF'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#EEEEEE' title='#EE'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#C0C0C0' title='#C0'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#808080' title='#80'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#404040' title='#40'></div>";
        html += "<div class='svg-bgswatch' style='background-color:black' title='#00'></div>";
        
        html += "<div class='svg-tb-button zoomin-icon' data-zoomFactor='2.0' title='Zoom in'></div>";
        html += "<div class='svg-tb-button zoomout-icon' data-zoomFactor='0.5' title='Zoom out'></div>";
        html += "<div class='svg-tb-button zoom11-icon' title='Restore zoom'></div>";
        html += "<span class='svg-tb-label'></span>";
        
        $svgToolbar.html(html);
        
        $(".svg-bgswatch", $svgToolbar).click(function (event) {
            var $elt = $(event.target);
            var $svgParent = $(".svg-preview", $svgPanel);
            if ($elt.hasClass("checker")) {
                $svgParent.addClass("checker");
            } else {
                $svgParent.removeClass("checker");
                $svgParent.css("background-color", $elt.css("background-color"));
            }
        });
        
        $(".svg-tb-button", $svgToolbar).click(function (event) {
            var $btn = $(event.currentTarget);
            if ($btn.is(".disabled")) { return; }
            
            var zoomFactor = $btn.attr("data-zoomFactor");
            if (isNaN(zoomFactor)) {
                currentState.zoomFactor = 1;
            } else {
                currentState.zoomFactor *= zoomFactor;
            }
            updatePanel(EditorManager.getCurrentFullEditor());
        });
    }
    
    function createSVGPanel() {
        // Create panel contents
        $svgPanel = $("<div class='svg-panel inline-widget no-focus'><div class='shadow top'></div><div class='shadow bottom'></div></div>");
        $svgPanel.append("<div class='svg-toolbar'></div><div class='svg-preview checker' style='margin: 15px'></div>");
        var $svgToolbar = $(".svg-toolbar", $svgPanel);
        populateToolbar($svgToolbar);
        
        // Listeners other than toobar
        $(".svg-preview", $svgPanel).click(handleSVGClick);
    }
    
    
    function handleDocumentChange(jqEvent, doc) {
        console.assert(EditorManager.getCurrentFullEditor() && EditorManager.getCurrentFullEditor().document === doc);
        
        updatePanel(EditorManager.getCurrentFullEditor());
    }
    
    /**
     */
    function attachToEditor(editor) {
        // Per-editor panel state
        if (!editor.svgPanelState) {
            editor.svgPanelState = {
                zoomFactor: 1, // start at 100%
                editor: editor
            };
        }
        currentState = editor.svgPanelState;
        
        // Update panel when text changes
        editor.document.on("change", handleDocumentChange);
        handleDocumentChange(null, editor.document);  // initial update
        
        currentEditor = editor;
    }
    
    function detachFromLastEditor() {
        if (currentEditor) {
            currentEditor.document.off("change", handleDocumentChange);
            currentState = null;
            currentEditor = null;
        }
    }
    
    function showSVGPanel(editor) {
        if (!$svgPanel) {
            createSVGPanel();
            
            // Inject panel into UI
            // TODO: use PanelManager to create top panel, once possible
            $("#editor-holder").before($svgPanel);
            needsWorkspaceLayout = true;
            
        } else if ($svgPanel.is(":hidden")) {
            $svgPanel.show();
            needsWorkspaceLayout = true;
        }
        
        attachToEditor(editor);
    }
    
    function hideSVGPanel() {
        if ($svgPanel && $svgPanel.is(":visible")) {
            $svgPanel.hide();
            WorkspaceManager.recomputeLayout();
        }
    }
    
    /**
     */
    function handleCurrentEditorChange() {
        detachFromLastEditor();
        
        var newEditor = EditorManager.getCurrentFullEditor();
        if (newEditor) {
            if (newEditor.document.getLanguage().getId() === "svg") {
                showSVGPanel(newEditor);
            } else {
                hideSVGPanel();
            }
        } else {
            hideSVGPanel();
        }
    }
    

    // Listen for editors to attach to
    MainViewManager.on("currentFileChange", handleCurrentEditorChange);
    
    ExtensionUtils.loadStyleSheet(module, "svg-preview.css")
        .done(function () {
            // Don't pick up initially visible editor until our stylesheet is loaded
            handleCurrentEditorChange();
        });
});
