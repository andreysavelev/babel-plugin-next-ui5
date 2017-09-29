'use strict';

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function (_ref) {
    var t = _ref.types;

    var ui5ModuleVisitor = {
        Program: {
            enter: function enter(path) {
                var filePath = _path2.default.resolve(path.hub.file.opts.filename);
                var sourceRootPath = getSourceRoot(path);

                var relativeFilePath = null;
                var relativeFilePathWithoutExtension = null;
                var namespace = getConfigProp(sourceRootPath, 'NAMESPACE');

                if (namespace !== '') {
                    namespace = namespace.replace(/\r?\n|\r/g, '');
                }

                if (filePath.startsWith(sourceRootPath)) {
                    relativeFilePath = _path2.default.relative(sourceRootPath, filePath);
                    relativeFilePathWithoutExtension = _path2.default.dirname(relativeFilePath) + _path2.default.sep + _path2.default.basename(relativeFilePath, _path2.default.extname(relativeFilePath));
                    relativeFilePathWithoutExtension = relativeFilePathWithoutExtension.replace(/\\/g, "/");
                }

                if (!path.state) {
                    path.state = {};
                }

                path.state.ui5 = {
                    filePath: filePath,
                    relativeFilePath: relativeFilePath,
                    relativeFilePathWithoutExtension: relativeFilePathWithoutExtension,
                    namespace: namespace,
                    className: null,
                    fullClassName: null,
                    superClassName: null,
                    imports: [],
                    staticMembers: []
                };
            }
        },

        ImportDeclaration: function ImportDeclaration(path) {
            var state = path.state.ui5;
            var node = path.node;
            var name = null;
            var src = node.source.value;

            if (src.startsWith("./") || src.startsWith("../")) {
                var sourceRootPath = getSourceRoot(path);
                src = _path2.default.relative(sourceRootPath, _path2.default.resolve(_path2.default.dirname(path.hub.file.opts.filename), src));
            }

            src = _path2.default.normalize(src);

            if (node.specifiers && node.specifiers.length === 1) {
                name = node.specifiers[0].local.name;
            } else {
                var parts = src.split(_path2.default.sep);
                name = parts[parts.length - 1];
            }

            if (node.leadingComments) {
                state.leadingComments = node.leadingComments;
            }

            var imp = {
                name: name,
                src: src.replace(/\\/g, "/")
            };
            state.imports.push(imp);

            path.remove();
        },

        ExportDeclaration: function ExportDeclaration(path) {
            var state = path.state.ui5;
            var program = path.hub.file.ast.program;

            var defineCallArgs = [t.arrayExpression(state.imports.map(function (i) {
                return t.stringLiteral(i.src);
            })), t.functionExpression(null, state.imports.map(function (i) {
                return t.identifier(i.name);
            }), t.blockStatement([t.expressionStatement(t.stringLiteral("use strict")), t.returnStatement(transformClass(path.node.declaration, program, state))]))];

            var defineCall = t.callExpression(t.identifier("sap.ui.define"), defineCallArgs);
            if (state.leadingComments) {
                defineCall.leadingComments = state.leadingComments;
            }
            path.replaceWith(defineCall);

            // Add static members
            for (var key in state.staticMembers) {
                var id = t.identifier(state.fullClassName + "." + key);
                var statement = t.expressionStatement(t.assignmentExpression("=", id, state.staticMembers[key]));
                path.insertAfter(statement);
            }
        },

        CallExpression: function CallExpression(path) {
            var state = path.state.ui5;
            var node = path.node;

            if (node.callee.type === "Super") {
                if (!state.superClassName) {
                    this.errorWithNode("The keyword 'super' can only used in a derrived class.");
                }

                var identifier = t.identifier(state.superClassName + ".apply");
                var args = t.arrayExpression(node.arguments);

                if (node.arguments.length === 1 && node.arguments[0].type === "Identifier" && node.arguments[0].name === "arguments") {
                    args = t.identifier("arguments");
                }

                path.replaceWith(t.callExpression(identifier, [t.identifier("this"), args]));
            } else if (node.callee.object && node.callee.object.type === "Super") {
                if (!state.superClassName) {
                    this.errorWithNode("The keyword 'super' can only used in a derrived class.");
                }

                var _identifier = t.identifier(state.superClassName + ".prototype" + "." + node.callee.property.name + ".apply");
                path.replaceWith(t.callExpression(_identifier, [t.identifier("this"), t.arrayExpression(node.arguments)]));
            }
        }
    };

    function transformClass(node, program, state) {
        if (node.type !== "ClassDeclaration") {
            return node;
        } else {
            resolveClass(node, state);

            var props = [];
            node.body.body.forEach(function (member) {
                if (member.type === "ClassMethod") {
                    var func = t.functionExpression(null, member.params, member.body);

                    if (!member.static) {
                        func.generator = member.generator;
                        func.async = member.async;
                        props.push(t.objectProperty(member.key, func));
                    } else {
                        func.body.body.unshift(t.expressionStatement(t.stringLiteral("use strict")));
                        state.staticMembers[member.key.name] = func;
                    }
                } else if (member.type == "ClassProperty") {
                    if (!member.static) {
                        props.push(t.objectProperty(member.key, member.value));
                    } else {
                        state.staticMembers[member.key.name] = member.value;
                    }
                }
            });

            var bodyJSON = t.objectExpression(props);
            var extendCallArgs = [t.stringLiteral(state.fullClassName), bodyJSON];
            var extendCall = t.callExpression(t.identifier(state.superClassName + ".extend"), extendCallArgs);
            return extendCall;
        }
    }

    function resolveClass(node, state) {
        state.className = node.id.name;
        state.superClassName = node.superClass.name;
        if (state.namespace) {
            state.fullClassName = state.namespace + "." + state.className;
        } else {
            state.fullClassName = state.className;
        }
    }

    function getSourceRoot(path) {
        var sourceRootPath = null;

        if (path.hub.file.opts.sourceRoot) {
            sourceRootPath = _path2.default.resolve(path.hub.file.opts.sourceRoot);
        } else {
            sourceRootPath = _path2.default.resolve("." + _path2.default.sep);
        }

        return sourceRootPath;
    }

    /**
    * Get value of property from ui5sk.properties file
    * @param {string} sourceRootPath - Path to the project folder
    * @param {string} prop - Name of property
    * @returns {string} - Returns value
    */
    function getConfigProp(sourceRootPath, prop) {
        var ui5skConfig = getFileContent(sourceRootPath + '/ui5sk.properties');
        var result = '';

        ui5skConfig.split('\n').forEach(function (item) {
            if (item.indexOf(prop) !== -1) {
                result = item.split('=')[1];
            }
        });

        return result;
    }

    /**
     * Read file Synchronous
     * @param {String} filePath - Path of file
     * @returns {String|Buffer} - Returns content of file
     */
    function getFileContent(filePath) {
        return _fs2.default.readFileSync(filePath, 'utf8');
    }

    return {
        visitor: ui5ModuleVisitor
    };
};
module.exports = exports.default;