/*
 * Copyright (c) 2012 Peter Flynn.
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
/*global define, brackets, $, DOMParser */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var TokenUtils              = brackets.getModule("utils/TokenUtils");
    
    
    // DEBUG: convenient place to turn logging on/off
    function _log() {
//        console.log.apply(console, arguments);
    }
    
    /** Returns true if name token of open tag (token after "<") */
    function isOpenTag(token) {
        // Open tag is "tag" with tagName set; close tag is "tag" with tagName null or "tag bracket" with tagName null (if self-closing)
        return token.type === "tag" && token.state.tagName;
    }
    
    function getTagName(token) {
        return token.state.tagName;
    }
    
    /** Returns how many ancestor tags the current token's tag has */
    function getDepth(token) {
        var level = 0;
        var context = token.state.context;
        while (context) {
            level++;
            context = context.prev;
        }
        return level;
    }
    
    
    /**
     * Given a lookup path to a specific XML tag, locates the start of that tag in the code editor and returns
     * its token. The lookup chain starts at chain[1] (chain[0] signifies the root). Each entry step tells us
     * which child tag to drill down to: chain[n].childIndex tells us which child of chain[n-1] to look for.
     *
     * For example, in:
     * <A>
     *     <B>
     *         <C>...</C>
     *     </B>
     *     <B>
     *         <C>...</C>
     *         <C>...</C>
     *     </B>
     * </A>
     * The middle "C" tag would be chain[1]=1, chain[2]=0 (child index 1 of A, child index 0 of that B).
     *
     * @param {!Editor} editor
     * @param {!Array.<{childIndex: number, tagName: string}>} chain
     * @return {?{editor: CodeMirror, pos: {ch:string, line:number}, token: object}}  TokenUtils state object
     */
    function findTag(editor, chain) {
        
        // We start at ch:1 becuase CM's token API's always ask for the char to the LEFT of the specified cursor pos; ch:0 thus implies out of bounds & always yields a null token
        var tokenIt = TokenUtils.getInitialContext(editor._codeMirror, {line: 0, ch: 1});
        _log("INITIAL TOKEN:", tokenIt.token);
        
        
        // DEBUG: log info about the current token
        function _logt(extra) {
            var token = tokenIt.token;
            _log("TOKEN: \"" + token.string + "\"", token, extra);
        }
        
        /** Skips past all initial meta, whitespace & comment tokens. Stops on first tag token (which must be type openTag) */
        function skipMeta() {
            _log("Moving to root tag openening tagname...");
            
            while (!isOpenTag(tokenIt.token)) {
                var moved = TokenUtils.moveNextToken(tokenIt);
                if (!moved) {
                    return false;
                }
                _logt();
            }
            return true;
        }
        
        /** Skips to the ">" token at the end of current opening tag (assumes we're currently in an opening tag).
         *  The ">" token's context stack INCLUDES that tag, so getDepth() there == getDepth() on the tag's immediate children. */
        function gotoEndOfOpenTag() {
            _log("gotoEndOfOpenTag() past open-tag '" + tokenIt.token.state.tagName + "'");
            
            do {
                var moved = TokenUtils.moveNextToken(tokenIt);
                if (!moved) {
                    return false;
                }
                _logt();
                if (tokenIt.token.string === "/>") {
                    return false;   // self-closing tags have no children, so we have a sync problem if we hit one
                }
            } while (tokenIt.token.type !== "tag bracket");
            return true;
        }
        
        /** Skips to the start of the next opening tag at the current nesting level */
        function gotoNextSiblingOpenTag() {
            var targetLevel = getDepth(tokenIt.token);
            _log("gotoNextSiblingOpenTag() moving along level #" + targetLevel);
            
            var level;
            do {
                var moved = TokenUtils.moveNextToken(tokenIt);
                if (!moved) {
                    return false;
                }
                level = getDepth(tokenIt.token);
                _logt("level #" + level);
                if (level < targetLevel) { // we've reached end of level we started at, with no success finding any more open tags
                    return false;
                }
            } while (!(isOpenTag(tokenIt.token) && level === targetLevel));
            return true;
        }
        
        
        skipMeta();
        _log("START TOKEN:", tokenIt.token);
        console.assert(isOpenTag(tokenIt.token));
        console.assert(getTagName(tokenIt.token) === "svg");
        
        // For each step of the chain (i.e. for each nesting level)...
        var curLevel = 1;
        while (curLevel < chain.length) {
            var childIndex = chain[curLevel].childIndex;
            var nChildrenSeen = 0;
            _log("Looking for child #" + childIndex + ", a " + chain[curLevel].tagName);
            
            // tokenIt is currently on the start of the parent tag - move to the end so we can start counting through its children
            gotoEndOfOpenTag();
            
            // For each child tag... (up until the Nth one, as specified by the chain)
            while (nChildrenSeen < childIndex + 1) {
                var hasNext = gotoNextSiblingOpenTag();
                if (!hasNext) {
                    console.error("SVG code in editor is out of sync with SVG DOM in preview. Can't find child #" + childIndex + " (a " + chain[curLevel].tagName + ") of " + chain[curLevel - 1].tagName);
                    return null;
                }
                if (isOpenTag(tokenIt.token)) {
                    nChildrenSeen++;
                    _log("Found some child tag. nChildrenSeen -> " + nChildrenSeen);
                }
            }
            _log("Found THE child tag, #" + childIndex);
            
            if (getTagName(tokenIt.token) !== chain[curLevel].tagName) {
                console.error("SVG code in editor is out of sync with SVG DOM in preview. Child #" + childIndex + " of " + chain[curLevel - 1].tagName + ": expected " + chain[curLevel].tagName + " but found " + getTagName(tokenIt.token));
                return null;
            }
            curLevel++;
        }
        
        return tokenIt;
    }

    
    
    exports.findTag = findTag;
});
