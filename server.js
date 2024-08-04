const express = require('express');
const exphbs = require('express-handlebars');
const sessions = require('client-sessions');
const path = require('path');
const oracledb = require('oracledb');
const bodyParser = require('body-parser');
const app = express();
const port = 3000; 

//database Configuration 
const dbConfig = {
    user: "dbs501_242v1a10",
    password: "23219231",
    connectString: "myoracle12c.senecacollege.ca:1521/oracle12c"
};

//handlebars Setup
app.engine('.hbs', exphbs.engine({
    extname: '.hbs',
    defaultLayout: false,
    layoutsDir: path.join(__dirname, 'views') 
}));
app.set('view engine', '.hbs');

//sessions Setup
app.use(sessions({
    cookieName: 'session',
    secret: 'Secret',
    duration: 24 * 60 * 60 * 1000,
    activeDuration: 1 * 60 * 60 * 1000,
    httpOnly: true,
    secure: true,
    ephemeral: true
}));

//middleware
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'))

//home Route
app.get('/', (req, res) => {
    res.render('main');
});

//employee Route 
app.get('/employees', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        console.log("Connected to database!");
        const [jobTitles, managers, departments] = await Promise.all([
            connection.execute(`SELECT DISTINCT JOB_ID, JOB_TITLE FROM HR_JOBS`),
            connection.execute(`SELECT EMPLOYEE_ID, FIRST_NAME || ' ' || LAST_NAME AS FULL_NAME 
                                 FROM HR_EMPLOYEES 
                                 WHERE EMPLOYEE_ID IN (SELECT DISTINCT MANAGER_ID FROM HR_EMPLOYEES)`),
            connection.execute(`SELECT DEPARTMENT_ID, DEPARTMENT_NAME FROM HR_DEPARTMENTS`)
        ]);
        res.render('employees', { jobTitles: jobTitles.rows, managers: managers.rows, departments: departments.rows });
    } catch (err) {
        console.error(err);
        res.status(500).send(`Internal Server Error: ${err.message}`);
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error(err); 
            }
        }
    }
});

//hire Employee Route Button
app.post('/hire', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        const { firstName, lastName, email, hireDate, phone, jobId, managerId, departmentId, salary } = req.body;
        const salaryNum = parseFloat(salary);

        if (isNaN(salaryNum) || salaryNum < 0) {
            return res.status(400).send("Invalid salary. Please enter a positive number.");
        }

        const managerIdNum = managerId === "" ? null : parseInt(managerId, 10);
        if (managerId && isNaN(managerIdNum)) {
            return res.status(400).send("Invalid manager ID. Please select a valid manager.");
        }

        const departmentIdNum = parseInt(departmentId, 10);
        if (isNaN(departmentIdNum)) {
            return res.status(400).send("Invalid department ID. Please select a valid department.");
        }        

        // Check Salary before Hire
        try {
            await connection.execute(
                `BEGIN
                    CHECK_SALARY(:jobId, :salary);
                END;`,
                {
                    jobId: jobId.toUpperCase(), 
                    salary: salaryNum
                }
            );
            

            //hire Employee if salary is within range
            try {
                const result = await connection.execute(
                    `BEGIN
                        Employee_hire_sp(:firstName, :lastName, :email, :salary, 
                            TO_DATE(:hireDate, 'YYYY-MM-DD'), :phone, :jobId, :managerId, :departmentId);
                    END;`,
                    {
                        firstName,
                        lastName,
                        email,
                        salary: salaryNum,
                        hireDate,
                        phone,
                        jobId,
                        managerId: managerIdNum,
                        departmentId: departmentIdNum
                    }
                );

                if (result.rowsAffected === 1) {
                    res.redirect('/employees?hireSuccess=true'); 
                } else {
                    res.redirect('/employees?hireSuccess=false'); 
                }
            } catch (procError) {
                res.status(500).send(`Error adding employee: ${procError.message}`);
            }

        } catch (procError) {
            //error message for safe URL transmission
            const errorMessage = encodeURIComponent(procError.message.split('\n')[0]);
            //Redirect with error
            res.redirect(`/employees?hireError=${errorMessage}`); 
        }

    } catch (err) {
        console.error(err);
        res.status(500).send(`Internal Server Error: ${err.message}`); 
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error(err);
            }
        }
    }
});




app.get('/jobs', async (req, res) => {
    res.render('jobs', { job_desc: null });
});

app.post('/jobs', async (req, res) => {
    try {

        if (!req.body.job_id) {
            res.status(400).send('Job ID is required to get the description.');
            return;
        }

        let job_desc;
        let connection;
        try {
            connection = await oracledb.getConnection(dbConfig);
            const result = await connection.execute(
                `BEGIN
                    :job_desc := get_job(:job_id);
                END;`,
                {
                    job_id: req.body.job_id,
                    job_desc: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
                }
            );
            job_desc = result.outBinds.job_desc;
        } catch (err) {
            console.error("Error getting job description:", err);
            res.status(500).send(`Internal Server Error: ${err.message}`);
            return; 
        } finally {
            if (connection) {
                try {
                    await connection.close();
                } catch (err) {
                    console.error("Error closing connection:", err);
                }
            }
        }

        res.render('jobs', { job_desc });
    } catch (err) {
        console.error("Error processing form:", err);
        res.status(500).send('An error occurred while processing your request.');
    }
});
  


app.get('/jobs/edit', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);

        const result = await connection.execute(
            `SELECT DISTINCT JOB_ID, JOB_TITLE, Min_Salary, Max_Salary FROM HR_JOBS` 
        );

        const jobs = result.rows.map(row => ({
            job_id: row[0],
            job_title: row[1],
            min_salary: row[2],
            max_salary: row[3]
        }));

        res.render('edit', { jobs }); 
    } catch (err) {
        console.error(err);
        res.status(500).send(`Internal Server Error: ${err.message}`);
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error(err);
            }
        }
    }
});



app.post('/jobs/edit', async (req, res) => {
    let connection;
    let message = null;
    let error = null;

    const { jobId, jobTitle, minSalary, maxSalary } = req.body;

    //input Validation 
    if (!jobId || !jobTitle || !minSalary || !maxSalary) {
        error = 'All fields are required.';
    } else if (isNaN(parseFloat(minSalary)) || isNaN(parseFloat(maxSalary))) {
        error = 'Min and Max Salary must be numbers.';
    } else if (parseFloat(minSalary) > parseFloat(maxSalary)) {
        error = 'Min Salary cannot be greater than Max Salary.';
    } else {
        const sanitizedJobTitle = jobTitle.replace(/[^a-zA-Z0-9_ ]/g, ''); 
        const sanitizedMinSalary = parseFloat(minSalary);
        const sanitizedMaxSalary = parseFloat(maxSalary);

        try {
            connection = await oracledb.getConnection(dbConfig);
            
            try {
                //call the stored procedure to update the job
                const result = await connection.execute(
                    `BEGIN
                        update_job(:jobId, :jobTitle, :minSalary, :maxSalary);
                    END;`,
                    { 
                        jobId, 
                        jobTitle: sanitizedJobTitle, 
                        minSalary: sanitizedMinSalary, 
                        maxSalary: sanitizedMaxSalary 
                    }
                );
                res.redirect('/jobs/edit'); 
            } catch (procError) {
                console.error("Error in stored procedure:", procError);
                error = `Error updating job: ${procError.message}`;
            }
        } catch (err) {
            console.error(err);
            error = 'Database connection error.';
        } finally {
            if (connection) {
                try {
                    await connection.close();
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }
    try {
        connection = await oracledb.getConnection(dbConfig);
        const result = await connection.execute(
            `SELECT JOB_ID, JOB_TITLE, MIN_SALARY, MAX_SALARY FROM HR_JOBS`
        );
        res.render('edit', { jobs: result.rows, message, error }); 
    } catch (err) {
        console.error(err);
        res.status(500).send(`Internal Server Error: ${err.message}`);
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error(err);
            }
        }
    }
});

  




// Job create
app.get('/jobs/create', (req, res) => {
    res.render('create', { 
        message: req.query.hireSuccess === 'true' ? 'Job created successfully!' : null,
        error: req.query.hireSuccess === 'false' ? 'Failed to create job.' : null 
    });
});

app.post('/jobs/create', async (req, res) => {
    let connection;
    let created = 'Job Created';
    let jobId = req.body.job_id;
    let jobTitle = req.body.job_title;
    let minSalary = req.body.min_sal;
    let maxSalary = req.body.max_sal;
    try {
        connection = await oracledb.getConnection(dbConfig);
        try {
            result = await connection.execute(
                `BEGIN
                    new_job(:jobId, :jobTitle, :minSalary, :maxSalary);
                END;`,
                {
                    jobId,
                    jobTitle,
                    minSalary,
                    maxSalary
                }
            );
            if (result.rowsAffected == 1) {
                created = 'Job created!';
            } else {
            }
        } catch (procError) {
            res.status(500).send(`Error creating job: ${procError.message}`);
        }
 
    } catch (err) {
        console.error(err);
        res.status(500).send(`Internal Server Error: ${err.message}`);
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error(err);
            }
        }
    }
    res.render('create', { created });
});








// Department
app.get('/departments', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        console.log("Connected to database!");
        const [departments] = await Promise.all([
            connection.execute(`SELECT DEPARTMENT_ID, DEPARTMENT_NAME FROM HR_DEPARTMENTS`)
        ]);
        res.render('departments', {departments: departments.rows });
    } catch (err) {
        console.error(err);
        res.status(500).send(`Internal Server Error: ${err.message}`);
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error(err);
            }
        }
    }
});


app.listen(3000, () => {
    console.log('Server listening on port 3000');
});