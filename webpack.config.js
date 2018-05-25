const path = require("path");
const webpack = require("webpack");
const CleanWebpackPlugin = require("clean-webpack-plugin");
const UglifyJSPlugin = require("uglifyjs-webpack-plugin");

const pkg = require("./package.json");
module.exports = {
    mode: "development",
    entry: "./src/index",
    output: {
        path: path.join(__dirname, "dist"),
        filename: "index.js",
        library: pkg.name,
        libraryTarget: "umd"
    },
    plugins: [
        new webpack.DefinePlugin({
            __VERSION__: JSON.stringify(pkg.version)
        }),
        new CleanWebpackPlugin(["build", "dist"], {
            root: __dirname
        })
    ],
    devtool: "source-map",
    resolve: {
        extensions: [".ts", ".js", ".json"]
    },
    module: {
        rules: [
            {
                test: /\.(js|ts)x?$/,
                loader: "ts-loader",
                exclude: [/node_modules/]
            },
            {
                enforce: "pre",
                test: /\.js$/,
                loader: "source-map-loader",
                exclude: [/node_modules/]
            }
        ]
    }
};