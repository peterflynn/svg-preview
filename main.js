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
/*global define, brackets, $, PathUtils */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var DocumentManager         = brackets.getModule("document/DocumentManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        ExtensionUtils          = brackets.getModule("utils/ExtensionUtils");
    
    var $svgPanel;
    
    var lastEditor;
    
    var currentState;
    
    
    function setPanelHeight(height) {
        if (height !== $svgPanel.lastHeight) {
            $svgPanel.height(height);
            $svgPanel.lastHeight = height;
            EditorManager.resizeEditor();
        }
    }
    
    /**
     */
    function updatePanel(editor) {
        var $svgParent = $(".svg-preview", $svgPanel);
        $svgParent.html(editor.document.getText());
        var $svgRoot = $svgParent.children();
        
        // Get natural size of the SVG
        var svgWidth, svgHeight;
        if ($svgRoot.attr("viewBox")) {
            var boundsStrs = $svgRoot.attr("viewBox").split(/[ ,]+/);
            svgWidth = parseFloat(boundsStrs[2]);
            svgHeight = parseFloat(boundsStrs[2]);
        } else {
            svgWidth = parseInt($svgRoot.attr("width"), 10);
            svgHeight = parseInt($svgRoot.attr("height"), 10);
        }
        
        // Specify actual width consistent with zoom factor
        var viewWidth = svgWidth * currentState.zoomFactor;
        var viewHeight = svgHeight * currentState.zoomFactor;
        
        // jQ auto lowercases the attr name, making it ignored (http://bugs.jquery.com/ticket/11166 resolved wontfix: "we don't support SVG")
        $svgRoot[0].setAttribute("viewBox", "0 0 " + svgWidth + " " + svgHeight);
        $svgRoot.attr("width", viewWidth);
        $svgRoot.attr("height", viewHeight);
        
        var desiredPanelHeight = $(".svg-toolbar", $svgPanel).outerHeight() + viewHeight + (15 * 2);
        setPanelHeight(desiredPanelHeight);
        
        $svgParent.width(viewWidth);
        $svgParent.height(viewHeight);
    }
    
    
    function populateToolbar($svgToolbar) {
        var html = "";
        
        html += "<div class='svg-bgswatch checker' title='Checkerboard'></div>";
        html += "<div class='svg-bgswatch' style='background-color:white' title='FF'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#EEEEEE' title='EE'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#C0C0C0' title='C0'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#808080' title='80'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#404040' title='40'></div>";
        html += "<div class='svg-bgswatch' style='background-color:black' title='00'></div>";
        
        html += "<div class='svg-tb-button' data-zoomFactor='2.0' title='Zoom in'><span class='svg-tb-label'>+</span></div>";
        html += "<div class='svg-tb-button' data-zoomFactor='0.5' title='Zoom out'><span class='svg-tb-label'>-</span></div>";
        html += "<div class='svg-tb-button'><span class='svg-tb-label' title='Restore zoom'>0</span></div>";
        
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
            var zoomFactor = $(event.currentTarget).attr("data-zoomFactor");
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
        $svgPanel = $("<div class='svg-panel inline-widget'><div class='shadow top'></div><div class='shadow bottom'></div></div>");
        $svgPanel.append("<div class='svg-toolbar'></div><div class='svg-preview checker' style='margin: 15px'></div>");
        var $svgToolbar = $(".svg-toolbar", $svgPanel);
        populateToolbar($svgToolbar);
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
        $(editor.document).on("change", handleDocumentChange);
        handleDocumentChange(null, editor.document);  // initial update (which sets panel size too)
        
        lastEditor = editor;
    }
    
    function detachFromLastEditor() {
        if (lastEditor) {
            $(lastEditor.document).off("change", handleDocumentChange);
            currentState = null;
        }
    }
    
    function showSVGPanel(editor) {
        if (!$svgPanel) {
            createSVGPanel();
            
            // Inject panel into UI
            $("#editor-holder").before($svgPanel);
        } else if ($svgPanel.is(":hidden")) {
            $svgPanel.show();
        }
        // we don't call resizeEditor() in either case, since it's guaranteed to be called below
        
        attachToEditor(editor);
    }
    
    function hideSVGPanel() {
        if ($svgPanel && $svgPanel.is(":visible")) {
            $svgPanel.hide();
            EditorManager.resizeEditor();
        }
    }
    
    /**
     */
    function handleCurrentEditorChange() {
        detachFromLastEditor();
        
        var newEditor = EditorManager.getCurrentFullEditor();
        if (newEditor) {
            var ext = PathUtils.filenameExtension(newEditor.document.file.fullPath);
            if (ext.toLowerCase() === ".svg") {
                showSVGPanel(newEditor);
            } else {
                hideSVGPanel();
            }
        } else {
            hideSVGPanel();
        }
    }
    

    // Listen for editors to attach to
    $(DocumentManager).on("currentDocumentChange", handleCurrentEditorChange);
    
    ExtensionUtils.loadStyleSheet(module, "svg-preview.css")
        .done(function () {
            // Don't pick up initially visible editor until our stylesheet is loaded
            handleCurrentEditorChange();
        });
});
