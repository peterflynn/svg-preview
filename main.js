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
        InlineWidget            = brackets.getModule("editor/InlineWidget").InlineWidget,
        ExtensionUtils          = brackets.getModule("utils/ExtensionUtils");
    
    
    /**
     */
    function updatePanel(panel) {
        var $svgParent = $(".svg-preview", panel.$htmlContent);
        $svgParent.html(panel.editor.document.getText());
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
        var viewWidth = svgWidth * panel.zoomFactor;
        var viewHeight = svgHeight * panel.zoomFactor;
        
        // jQ auto lowercases the attr name, making it ignored (http://bugs.jquery.com/ticket/11166 resolved wontfix: "we don't support SVG")
//        $svgRoot.attr("viewBox", "0 0 " + svgWidth + " " + svgHeight);
        $svgRoot[0].setAttribute("viewBox", "0 0 " + svgWidth + " " + svgHeight);
        $svgRoot.attr("width", viewWidth);
        $svgRoot.attr("height", viewHeight);
        
        var desiredPanelHeight = $(".svg-toolbar", panel.$htmlContent).outerHeight() + viewHeight + (15 * 2);
        if (desiredPanelHeight !== panel.height) {
            panel.editor.setInlineWidgetHeight(panel, desiredPanelHeight, false);
            panel.height = desiredPanelHeight;
        }
        
        $svgParent.width(viewWidth);
        $svgParent.height(viewHeight);
    }
    
    
    function createToolbar(panel, $svgToolbar) {
        var html = "";
        
        html += "<div class='svg-bgswatch checker'></div>";
        html += "<div class='svg-bgswatch' style='background-color:white'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#EEEEEE'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#C0C0C0'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#808080'></div>";
        html += "<div class='svg-bgswatch' style='background-color:#404040'></div>";
        html += "<div class='svg-bgswatch' style='background-color:black'></div>";
        
        html += "<div class='svg-tb-button' data-zoomFactor='2.0'><span class='svg-tb-label'>+</span></div>";
        html += "<div class='svg-tb-button' data-zoomFactor='0.5'><span class='svg-tb-label'>-</span></div>";
        html += "<div class='svg-tb-button'><span class='svg-tb-label'>0</span></div>";
        
        $svgToolbar.html(html);
        
        $(".svg-bgswatch", $svgToolbar).click(function (event) {
            var $elt = $(event.target);
            var $svgParent = $(".svg-preview", panel.$htmlContent);
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
                panel.zoomFactor = 1;
            } else {
                panel.zoomFactor *= zoomFactor;
            }
            updatePanel(panel);
        });
    }
    
    /**
     */
    function addPreviewToEditor(editor) {
        // Create panel
        var panel = new InlineWidget();
        
        panel.load(editor);
        panel.$htmlContent.append("<div class='svg-toolbar'></div><div class='svg-preview checker' style='margin: 15px'></div>");
        panel.height = 100;  // arbitrary starting point
        panel.zoomFactor = 1; // start at 100%
        
        var $svgToolbar = $(".svg-toolbar", panel.$htmlContent);
        createToolbar(panel, $svgToolbar);
        
        // Attach panel to editor
        editor.svgPanel = panel;
        panel.editor = editor;
        editor.addInlineWidget({line: 0, ch: 0}, panel);
        
        // Update panel when text changes
        $(editor.document).on("change", function () {
            updatePanel(panel, editor);
        });
        updatePanel(panel, editor);
    }
    
    /**
     */
    function handleActiveEditorChange(jqEvent, newEditor, oldEditor) {
        if (newEditor && !newEditor.svgPanel) {
            var ext = PathUtils.filenameExtension(newEditor.document.file.fullPath);
            if (ext.toLowerCase() === ".svg") {
                addPreviewToEditor(newEditor);
            }
        }
    }
    

    // Listen for editors to attach to
    $(EditorManager).on("activeEditorChange", handleActiveEditorChange);
    
    ExtensionUtils.loadStyleSheet(module, "svg-preview.css")
        .done(function () {
            // Don't pick up initially visible editor until our stylesheet is loaded
            handleActiveEditorChange(null, EditorManager.getActiveEditor(), null);
        });
});
