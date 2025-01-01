const CellType = Object.freeze({
    EMPTY: "",
    X: "X",
    O: "O"
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CellType;
}

// export default CellType;