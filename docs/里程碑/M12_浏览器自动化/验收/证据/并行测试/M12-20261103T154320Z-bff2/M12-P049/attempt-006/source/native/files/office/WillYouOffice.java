import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.apache.poi.openxml4j.util.ZipSecureFile;
import org.apache.poi.ss.formula.FormulaParser;
import org.apache.poi.ss.formula.FormulaType;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.FormulaEvaluator;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.xssf.usermodel.XSSFEvaluationWorkbook;

/** Calculation-only helper. The complete output is a private candidate, never a
 * replacement for the original package. The native host supplies sandboxed paths
 * and enforces process budgets; the caller extracts only declared t/v fields. */
public final class WillYouOffice {
    public static void main(String[] args) throws Exception {
        if (args.length != 3 || (!args[0].equals("calculate") && !args[0].equals("validate"))) {
            throw new IllegalArgumentException("Expected fixed operation and private paths");
        }
        boolean validating = args[0].equals("validate");
        Path input = Path.of(args[1]), output = Path.of(args[2]);
        if (Files.size(input) > 40L * 1024 * 1024 || (!validating && Files.exists(output))) {
            throw new IllegalArgumentException("Input budget or private output precondition failed");
        }
        ZipSecureFile.setMaxEntrySize(64L * 1024 * 1024);
        ZipSecureFile.setMaxTextSize(64L * 1024 * 1024);
        ZipSecureFile.setMaxFileCount(8192);
        // The upstream minimum inflate ratio rejects legitimate repetitive XML.
        // The host preflight independently caps actual aggregate/entry bytes;
        // keep POI's own per-entry/count limits as a second layer.
        ZipSecureFile.setMinInflateRatio(0.0);
        int count = 0;
        try (InputStream source = Files.newInputStream(input);
             XSSFWorkbook workbook = new XSSFWorkbook(source)) {
            if (validating) {
                if (Files.size(output) > 8L * 1024 * 1024) throw new IllegalArgumentException("Formula input budget exceeded");
                XSSFEvaluationWorkbook context = XSSFEvaluationWorkbook.create(workbook);
                for (String line : Files.readAllLines(output, StandardCharsets.UTF_8)) {
                    String[] fields = line.split("\t", -1);
                    if (fields.length != 3 || ++count > 10000) throw new IllegalArgumentException("Invalid formula request");
                    int sheet = Integer.parseInt(fields[0]), row = Integer.parseInt(fields[1]);
                    String formula = new String(Base64.getDecoder().decode(fields[2]), StandardCharsets.UTF_8);
                    if (sheet < 0 || sheet >= workbook.getNumberOfSheets() || row < 0 || row >= 1048576 || formula.isBlank() || formula.length() > 8192) throw new IllegalArgumentException("Invalid formula context");
                    // Parse only the requested changed formula. No evaluation,
                    // workbook write, external link read or macro execution.
                    // POI may create UDF names in this private in-memory copy.
                    FormulaParser.parse(formula, context, FormulaType.CELL, sheet, row);
                }
                if (count == 0) throw new IllegalArgumentException("Empty formula request");
                System.out.println("WILLYOU_OFFICE_RESULT={\"engine\":\"Apache POI 5.5.1\",\"formulas\":" + count + "}");
                return;
            }
            FormulaEvaluator evaluator = workbook.getCreationHelper().createFormulaEvaluator();
            evaluator.setIgnoreMissingWorkbooks(false);
            for (Sheet sheet : workbook) {
                for (Row row : sheet) {
                    for (Cell cell : row) {
                        if (cell.getCellType() == CellType.FORMULA) {
                            // Unsupported formulas fail the whole candidate. We
                            // never substitute a blank or an unrelated old cache.
                            evaluator.evaluateFormulaCell(cell);
                            count++;
                        }
                    }
                }
            }
            try (OutputStream target = Files.newOutputStream(output, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                workbook.write(target);
            }
        }
        if (Files.size(output) > 40L * 1024 * 1024) throw new IllegalStateException("Calculation candidate exceeds 40 MiB");
        System.out.println("WILLYOU_OFFICE_RESULT={\"engine\":\"Apache POI 5.5.1\",\"formulas\":" + count + "}");
    }
}
